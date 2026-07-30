import AVFoundation
import CoreLocation
import EventKit
import Foundation
import Photos
import Speech
import Tauri

private struct VoiceInputArgs: Decodable {
    let locale: String?
}

private struct PermissionRequestArgs: Decodable {
    let permissions: [String]?
}

private enum PermissionAlias {
    static let microphone = "microphone"
    static let calendar = "calendar"
    static let reminders = "reminders"
    static let photos = "photos"
    static let location = "location"
}

final class MobileAssistantPlugin: Plugin, CLLocationManagerDelegate {
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
                    domain: "XAgentMobileAssistant",
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
