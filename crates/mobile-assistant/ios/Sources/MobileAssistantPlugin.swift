import AVFoundation
import CoreLocation
import EventKit
import Foundation
import MessageUI
import Photos
import Speech
import Tauri

private struct VoiceInputArgs: Decodable {
    let locale: String?
}

private struct PermissionRequestArgs: Decodable {
    let permissions: [String]?
}

private struct CalendarRangeArgs: Decodable {
    let startMs: Int64
    let endMs: Int64
    let limit: UInt16
}

private struct ReminderListArgs: Decodable {
    let incompleteOnly: Bool
    let limit: UInt16
}

private struct CreateCalendarEventArgs: Decodable {
    let title: String
    let startMs: Int64
    let endMs: Int64
    let allDay: Bool
    let location: String?
    let notes: String?
}

private struct CreateReminderArgs: Decodable {
    let title: String
    let dueMs: Int64?
    let notes: String?
}

private struct ComposeMessageArgs: Decodable {
    let kind: String
    let recipients: [String]
    let subject: String?
    let body: String?
}

private enum PermissionAlias {
    static let microphone = "microphone"
    static let calendar = "calendar"
    static let reminders = "reminders"
    static let photos = "photos"
    static let location = "location"
}

final class MobileAssistantPlugin: Plugin, CLLocationManagerDelegate,
    MFMailComposeViewControllerDelegate, MFMessageComposeViewControllerDelegate
{
    private let eventStore = EKEventStore()
    private let locationManager = CLLocationManager()
    private var locationPermissionInvokes: [Invoke] = []

    private var audioEngine: AVAudioEngine?
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?
    private var speechTimeout: DispatchWorkItem?
    private var voiceInvoke: Invoke?

    override init() {
        super.init()
        locationManager.delegate = self
    }

    @objc func status(_ invoke: Invoke) {
        invoke.resolve([
            "backend": "ios-native",
            "available": true,
            "voiceInputAvailable": true,
            // The mobile-execution plugin owns the security-scoped folder
            // picker and keeps bookmark access alive for file tools, a-Shell
            // and agent runs in this process.
            "externalFolderMountAvailable": true,
            "cloudSyncAvailable": false,
            // HealthKit and HomeKit require provisioning capabilities. Keep
            // them unavailable in unsigned builds instead of displaying a
            // switch that can never be granted after sideloading.
            "healthAvailable": false,
            "homeAvailable": false,
            "permissionAliases": [
                "microphone": PermissionAlias.microphone,
                "calendar": PermissionAlias.calendar,
                "reminders": PermissionAlias.reminders,
                "photos": PermissionAlias.photos,
                "location": PermissionAlias.location,
            ],
            "detail": "iOS permissions are requested individually. Health and Home require a signed provisioning profile with matching Apple capabilities.",
        ])
    }

    @objc override public func checkPermissions(_ invoke: Invoke) {
        invoke.resolve(permissionPayload())
    }

    @objc override public func requestPermissions(_ invoke: Invoke) {
        let request = try? invoke.parseArgs(PermissionRequestArgs.self)
        guard let alias = request?.permissions?.first else {
            checkPermissions(invoke)
            return
        }

        switch alias {
        case PermissionAlias.microphone:
            requestVoicePermissions(invoke)
        case PermissionAlias.calendar:
            requestEventPermission(invoke, entity: .event)
        case PermissionAlias.reminders:
            requestEventPermission(invoke, entity: .reminder)
        case PermissionAlias.photos:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] _ in
                DispatchQueue.main.async { self?.checkPermissions(invoke) }
            }
        case PermissionAlias.location:
            let state = locationPermissionState()
            guard state == "prompt" else {
                checkPermissions(invoke)
                return
            }
            locationPermissionInvokes.append(invoke)
            DispatchQueue.main.async { [weak self] in
                self?.locationManager.requestWhenInUseAuthorization()
            }
        default:
            invoke.reject("Unknown mobile permission: \(alias)")
        }
    }

    @objc func startVoiceInput(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(VoiceInputArgs.self)
        guard combinedVoicePermissionState() == "granted" else {
            invoke.reject("Microphone and Speech Recognition permissions are required")
            return
        }
        guard voiceInvoke == nil else {
            invoke.reject("Voice input is already active")
            return
        }

        let localeIdentifier = args.locale?.trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveLocale = localeIdentifier.flatMap {
            $0.isEmpty ? nil : Locale(identifier: $0)
        } ?? Locale.current
        guard let recognizer = SFSpeechRecognizer(locale: effectiveLocale),
              recognizer.isAvailable
        else {
            invoke.reject("Speech recognition is unavailable for \(effectiveLocale.identifier)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.beginVoiceInput(
                invoke,
                recognizer: recognizer,
                locale: effectiveLocale.identifier
            )
        }
    }

    @objc func listCalendarEvents(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CalendarRangeArgs.self)
        guard canReadEvents(.event) else {
            invoke.reject("Full calendar access is required before reading events")
            return
        }
        let start = date(milliseconds: args.startMs)
        let end = date(milliseconds: args.endMs)
        guard end > start else {
            invoke.reject("Calendar range end must be after start")
            return
        }
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .prefix(clampedLimit(args.limit))
            .map { event in
                [
                    "id": event.eventIdentifier ?? "",
                    "title": event.title ?? "Untitled event",
                    "startMs": milliseconds(event.startDate),
                    "endMs": milliseconds(event.endDate),
                    "allDay": event.isAllDay,
                    "location": event.location.map { $0 as Any } ?? NSNull(),
                    "notes": event.notes.map { $0 as Any } ?? NSNull(),
                    "calendar": event.calendar?.title.map { $0 as Any } ?? NSNull(),
                ] as [String: Any]
            }
        invoke.resolve(Array(events))
    }

    @objc func listReminders(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ReminderListArgs.self)
        guard canReadEvents(.reminder) else {
            invoke.reject("Full reminders access is required before reading reminders")
            return
        }
        let predicate = eventStore.predicateForReminders(in: nil)
        eventStore.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self else {
                invoke.reject("The reminders service is unavailable")
                return
            }
            let payload = (reminders ?? [])
                .filter { !args.incompleteOnly || !$0.isCompleted }
                .sorted { lhs, rhs in
                    let left = self.reminderDueDate(lhs) ?? .distantFuture
                    let right = self.reminderDueDate(rhs) ?? .distantFuture
                    if left == right { return (lhs.title ?? "") < (rhs.title ?? "") }
                    return left < right
                }
                .prefix(self.clampedLimit(args.limit))
                .map { reminder in
                    [
                        "id": reminder.calendarItemIdentifier,
                        "title": reminder.title ?? "Untitled reminder",
                        "dueMs": self.reminderDueDate(reminder)
                            .map { self.milliseconds($0) as Any } ?? NSNull(),
                        "completed": reminder.isCompleted,
                        "notes": reminder.notes.map { $0 as Any } ?? NSNull(),
                        "list": reminder.calendar?.title.map { $0 as Any } ?? NSNull(),
                    ] as [String: Any]
                }
            invoke.resolve(Array(payload))
        }
    }

    @objc func createCalendarEvent(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CreateCalendarEventArgs.self)
        let title = args.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let start = date(milliseconds: args.startMs)
        let end = date(milliseconds: args.endMs)
        guard !title.isEmpty, end > start else {
            invoke.reject("A title and an end after the start are required")
            return
        }
        guard canWriteEvents(.event), let calendar = eventStore.defaultCalendarForNewEvents else {
            invoke.reject("Calendar write access and a writable default calendar are required")
            return
        }
        let event = EKEvent(eventStore: eventStore)
        event.calendar = calendar
        event.title = title
        event.startDate = start
        event.endDate = end
        event.isAllDay = args.allDay
        event.location = normalized(args.location)
        event.notes = normalized(args.notes)
        do {
            try eventStore.save(event, span: .thisEvent, commit: true)
            invoke.resolve([
                "id": event.eventIdentifier.map { $0 as Any } ?? NSNull(),
                "presented": false,
                "detail": "Calendar event saved to \(calendar.title)",
            ])
        } catch {
            invoke.reject("Unable to save calendar event: \(error.localizedDescription)")
        }
    }

    @objc func createReminder(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CreateReminderArgs.self)
        let title = args.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            invoke.reject("A reminder title is required")
            return
        }
        guard canWriteEvents(.reminder), let calendar = eventStore.defaultCalendarForNewReminders()
        else {
            invoke.reject("Reminders write access and a writable default list are required")
            return
        }
        let reminder = EKReminder(eventStore: eventStore)
        reminder.calendar = calendar
        reminder.title = title
        reminder.notes = normalized(args.notes)
        if let dueMs = args.dueMs {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second],
                from: date(milliseconds: dueMs)
            )
        }
        do {
            try eventStore.save(reminder, commit: true)
            invoke.resolve([
                "id": reminder.calendarItemIdentifier,
                "presented": false,
                "detail": "Reminder saved to \(calendar.title)",
            ])
        } catch {
            invoke.reject("Unable to save reminder: \(error.localizedDescription)")
        }
    }

    @objc func composeMessage(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ComposeMessageArgs.self)
        let recipients = args.recipients
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let presenter = Self.topViewController() else {
            invoke.reject("Could not present the system composer")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                invoke.reject("The system composer is unavailable")
                return
            }
            if args.kind == "email" {
                guard MFMailComposeViewController.canSendMail() else {
                    invoke.reject("No configured mail account can present the iOS mail composer")
                    return
                }
                let composer = MFMailComposeViewController()
                composer.mailComposeDelegate = self
                composer.setToRecipients(recipients)
                if let subject = self.normalized(args.subject) { composer.setSubject(subject) }
                if let body = self.normalized(args.body) {
                    composer.setMessageBody(body, isHTML: false)
                }
                presenter.present(composer, animated: true) {
                    invoke.resolve([
                        "id": NSNull(),
                        "presented": true,
                        "detail": "Mail draft opened for review; the user must send or cancel it",
                    ])
                }
                return
            }
            guard args.kind == "sms" else {
                invoke.reject("Message kind must be email or sms")
                return
            }
            guard MFMessageComposeViewController.canSendText() else {
                invoke.reject("SMS composition is unavailable on this device")
                return
            }
            let composer = MFMessageComposeViewController()
            composer.messageComposeDelegate = self
            composer.recipients = recipients
            composer.body = self.normalized(args.body)
            presenter.present(composer, animated: true) {
                invoke.resolve([
                    "id": NSNull(),
                    "presented": true,
                    "detail": "SMS draft opened for review; the user must send or cancel it",
                ])
            }
        }
    }

    func mailComposeController(
        _ controller: MFMailComposeViewController,
        didFinishWith result: MFMailComposeResult,
        error: Error?
    ) {
        controller.dismiss(animated: true)
    }

    func messageComposeViewController(
        _ controller: MFMessageComposeViewController,
        didFinishWith result: MessageComposeResult
    ) {
        controller.dismiss(animated: true)
    }

    private func beginVoiceInput(
        _ invoke: Invoke,
        recognizer: SFSpeechRecognizer,
        locale: String
    ) {
        voiceInvoke = invoke
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let engine = AVAudioEngine()
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = false
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 else {
                throw NSError(
                    domain: "XgentMobileAssistant",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "The microphone returned an invalid audio format"]
                )
            }
            input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
                request.append(buffer)
            }
            audioEngine = engine
            speechRequest = request
            engine.prepare()
            try engine.start()

            speechTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let result, result.isFinal {
                    let transcription = result.bestTranscription
                    let text = transcription.formattedString.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    let confidence: Double? = transcription.segments.isEmpty
                        ? nil
                        : Double(
                            transcription.segments.map(\.confidence).reduce(0, +)
                                / Float(transcription.segments.count)
                        )
                    if text.isEmpty {
                        self.finishVoiceInput(error: "Speech recognition returned no text")
                    } else {
                        self.finishVoiceInput(
                            result: [
                                "text": text,
                                "locale": locale,
                                "confidence": confidence.map { $0 as Any } ?? NSNull(),
                            ]
                        )
                    }
                } else if let error {
                    self.finishVoiceInput(error: error.localizedDescription)
                }
            }

            let timeout = DispatchWorkItem { [weak self] in
                self?.finishVoiceInput(error: "Voice input timed out")
            }
            speechTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: timeout)
        } catch {
            finishVoiceInput(error: "Unable to start voice input: \(error.localizedDescription)")
        }
    }

    private func finishVoiceInput(result: [String: Any]? = nil, error: String? = nil) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let invoke = self.voiceInvoke
            self.voiceInvoke = nil
            self.speechTimeout?.cancel()
            self.speechTimeout = nil
            self.speechTask?.cancel()
            self.speechTask = nil
            self.speechRequest?.endAudio()
            self.speechRequest = nil
            if let engine = self.audioEngine {
                engine.stop()
                engine.inputNode.removeTap(onBus: 0)
            }
            self.audioEngine = nil
            try? AVAudioSession.sharedInstance().setActive(
                false,
                options: .notifyOthersOnDeactivation
            )
            guard let invoke else { return }
            if let result {
                invoke.resolve(result)
            } else {
                invoke.reject(error ?? "Voice input failed")
            }
        }
    }

    private func requestVoicePermissions(_ invoke: Invoke) {
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] _ in
            SFSpeechRecognizer.requestAuthorization { _ in
                DispatchQueue.main.async { self?.checkPermissions(invoke) }
            }
        }
    }

    private func requestEventPermission(_ invoke: Invoke, entity: EKEntityType) {
        if #available(iOS 17.0, *) {
            let completion: (Bool, Error?) -> Void = { [weak self] _, error in
                DispatchQueue.main.async {
                    if let error {
                        invoke.reject(error.localizedDescription)
                    } else {
                        self?.checkPermissions(invoke)
                    }
                }
            }
            if entity == .event {
                eventStore.requestFullAccessToEvents(completion: completion)
            } else {
                eventStore.requestFullAccessToReminders(completion: completion)
            }
        } else {
            eventStore.requestAccess(to: entity) { [weak self] _, error in
                DispatchQueue.main.async {
                    if let error {
                        invoke.reject(error.localizedDescription)
                    } else {
                        self?.checkPermissions(invoke)
                    }
                }
            }
        }
    }

    private func permissionPayload() -> [String: String] {
        [
            PermissionAlias.microphone: combinedVoicePermissionState(),
            PermissionAlias.calendar: eventPermissionState(.event),
            PermissionAlias.reminders: eventPermissionState(.reminder),
            PermissionAlias.photos: photoPermissionState(),
            PermissionAlias.location: locationPermissionState(),
        ]
    }

    private func combinedVoicePermissionState() -> String {
        let audio: String
        switch AVAudioSession.sharedInstance().recordPermission {
        case .undetermined: audio = "prompt"
        case .denied: audio = "denied"
        case .granted: audio = "granted"
        @unknown default: audio = "prompt"
        }
        let speech: String
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined: speech = "prompt"
        case .denied, .restricted: speech = "denied"
        case .authorized: speech = "granted"
        @unknown default: speech = "prompt"
        }
        if audio == "denied" || speech == "denied" { return "denied" }
        if audio == "granted" && speech == "granted" { return "granted" }
        return "prompt"
    }

    private func eventPermissionState(_ entity: EKEntityType) -> String {
        let state = EKEventStore.authorizationStatus(for: entity)
        if #available(iOS 17.0, *) {
            switch state {
            case .authorized, .fullAccess: return "granted"
            case .writeOnly: return "granted"
            case .denied, .restricted: return "denied"
            case .notDetermined: return "prompt"
            @unknown default: return "prompt"
            }
        }
        switch state {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private func canReadEvents(_ entity: EKEntityType) -> Bool {
        let state = EKEventStore.authorizationStatus(for: entity)
        if #available(iOS 17.0, *) {
            return state == .authorized || state == .fullAccess
        }
        return state == .authorized
    }

    private func canWriteEvents(_ entity: EKEntityType) -> Bool {
        let state = EKEventStore.authorizationStatus(for: entity)
        if #available(iOS 17.0, *) {
            return state == .authorized || state == .fullAccess || state == .writeOnly
        }
        return state == .authorized
    }

    private func date(milliseconds: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
    }

    private func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded())
    }

    private func clampedLimit(_ value: UInt16) -> Int {
        min(200, max(1, Int(value)))
    }

    private func reminderDueDate(_ reminder: EKReminder) -> Date? {
        reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) }
    }

    private func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func topViewController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
        var current = root
        while let presented = current?.presentedViewController {
            current = presented
        }
        if let navigation = current as? UINavigationController {
            return navigation.visibleViewController ?? navigation
        }
        if let tabs = current as? UITabBarController {
            return tabs.selectedViewController ?? tabs
        }
        return current
    }

    private func photoPermissionState() -> String {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized, .limited: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private func locationPermissionState() -> String {
        guard CLLocationManager.locationServicesEnabled() else { return "denied" }
        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined else { return }
        let invokes = locationPermissionInvokes
        locationPermissionInvokes.removeAll()
        for invoke in invokes {
            checkPermissions(invoke)
        }
    }
}

@_cdecl("init_plugin_mobile_assistant")
func initPlugin() -> Plugin {
    MobileAssistantPlugin()
}
