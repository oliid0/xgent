import Darwin
import Foundation

protocol CommandInputSource {
    func duplicateStream() throws -> UnsafeMutablePointer<FILE>
    func close()
}

extension TemporaryInput: CommandInputSource {}

/// A bounded, nonblocking write queue for a command's live stdin.
/// The writer queue owns descriptor closure, so an interrupted write cannot hit a reused FD.
final class CommandInputStream: CommandInputSource {
    private let readHandle: FileHandle
    private let writeDescriptor: Int32
    private let queue = DispatchQueue(label: "com.ohi.xgent.command-input")
    private let lock = NSLock()
    private var queuedBytes = 0
    private var eofRequested = false
    private var stopped = false
    private var writerClosed = false
    private let onClosed: (String?) -> Void

    init(onClosed: @escaping (String?) -> Void) throws {
        var descriptors: [Int32] = [-1, -1]
        guard Darwin.pipe(&descriptors) == 0 else {
            throw MobileExecutionError.io("Could not create command input pipe")
        }
        let flags = fcntl(descriptors[1], F_GETFL)
        guard flags >= 0, fcntl(descriptors[1], F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptors[1], F_SETNOSIGPIPE, 1) == 0 else {
            Darwin.close(descriptors[0])
            Darwin.close(descriptors[1])
            throw MobileExecutionError.io("Could not configure command input pipe")
        }
        readHandle = FileHandle(fileDescriptor: descriptors[0], closeOnDealloc: true)
        writeDescriptor = descriptors[1]
        self.onClosed = onClosed
    }

    func duplicateStream() throws -> UnsafeMutablePointer<FILE> {
        let duplicate = Darwin.dup(readHandle.fileDescriptor)
        guard duplicate >= 0, let stream = fdopen(duplicate, "r") else {
            if duplicate >= 0 { Darwin.close(duplicate) }
            throw MobileExecutionError.io("Could not duplicate live command input")
        }
        setvbuf(stream, nil, _IONBF, 0)
        return stream
    }

    func enqueue(_ bytes: Data, eof: Bool) throws {
        guard bytes.count <= 16 * 1024, !bytes.isEmpty || eof else {
            throw MobileExecutionError.invalidRequest("Input must contain 1–16384 bytes or EOF")
        }
        lock.lock()
        guard !stopped && !eofRequested else {
            lock.unlock()
            throw MobileExecutionError.invalidRequest("Command input is closed")
        }
        guard queuedBytes + bytes.count <= 64 * 1024 else {
            lock.unlock()
            throw MobileExecutionError.invalidRequest("Command input is full; wait and retry")
        }
        queuedBytes += bytes.count
        eofRequested = eof
        // Schedule under the same lock that accepts input, preserving concurrent request order.
        queue.async { [self] in
            defer { lock.lock(); queuedBytes -= bytes.count; lock.unlock() }
            if let failure = write(bytes) { finishWriter(error: failure); return }
            if eof { finishWriter(error: nil) }
        }
        lock.unlock()
    }

    func close() {
        lock.lock()
        stopped = true
        lock.unlock()
        queue.async { [self] in finishWriter(error: nil) }
        try? readHandle.close()
    }

    private func write(_ bytes: Data) -> String? {
        bytes.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return nil }
            var offset = 0
            var descriptor = pollfd(fd: writeDescriptor, events: Int16(POLLOUT), revents: 0)
            while offset < buffer.count {
                lock.lock()
                let stop = stopped || writerClosed
                lock.unlock()
                if stop { return nil }
                let count = Darwin.write(writeDescriptor, base.advanced(by: offset), buffer.count - offset)
                if count > 0 { offset += count; continue }
                if count < 0 && errno == EINTR { continue }
                if count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) {
                    let ready = Darwin.poll(&descriptor, 1, 100)
                    if ready >= 0 || errno == EINTR { continue }
                }
                return "Command input failed: \(String(cString: strerror(errno)))"
            }
            return nil
        }
    }

    private func finishWriter(error: String?) {
        lock.lock()
        let close = !writerClosed
        writerClosed = true
        stopped = true
        lock.unlock()
        if close {
            Darwin.close(writeDescriptor)
            onClosed(error)
        }
    }

    deinit {
        // Pending queue blocks retain this object; there can be no active writer here.
        if !writerClosed { Darwin.close(writeDescriptor) }
        try? readHandle.close()
    }
}
