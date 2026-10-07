import Foundation

// NSItemProvider may never finish after its source app or destination closes.
// Cancellation resumes exactly once and also cancels the provider's Progress.
final class XgentClipboardLoad<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var result: Result<Value, Error>?
    private var progress: Progress?

    nonisolated static func load(_ start: (@escaping @Sendable (Result<Value, Error>) -> Void) -> Progress) async throws -> Value {
        let load = XgentClipboardLoad<Value>()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard load.install(continuation) else { return }
                load.started(start { load.complete($0) })
            }
        }, onCancel: { load.complete(.failure(CancellationError())) })
    }

    private func install(_ next: CheckedContinuation<Value, Error>) -> Bool {
        lock.lock()
        if let result { lock.unlock(); next.resume(with: result); return false }
        continuation = next
        lock.unlock()
        return true
    }

    private func started(_ next: Progress) {
        lock.lock()
        let finished = result != nil
        let cancelled: Bool
        if case .failure(let error) = result { cancelled = error is CancellationError }
        else { cancelled = false }
        if !finished { progress = next }
        lock.unlock()
        if cancelled { next.cancel() }
    }

    private func complete(_ value: Result<Value, Error>) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = value
        let continuation = continuation, progress = progress
        self.continuation = nil; self.progress = nil
        lock.unlock()
        if case .failure(let error) = value, error is CancellationError { progress?.cancel() }
        continuation?.resume(with: value)
    }
}
