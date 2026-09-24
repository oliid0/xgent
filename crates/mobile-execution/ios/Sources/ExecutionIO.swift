import Darwin
import Foundation

struct BoundedOutput {
    let text: String
    let truncated: Bool
    let openAfterExit: Bool
}

final class BoundedPOSIXPipe {
    private let limit: Int
    private let readHandle: FileHandle
    private let readerDone = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var data = Data()
    private var didTruncate = false
    private var writerClosed = false
    private var stopRequested = false
    private let onOutput: ((Data) -> Void)?

    let writeDescriptor: Int32

    init(limit: Int = 400 * 1024, onOutput: ((Data) -> Void)? = nil) throws {
        self.limit = limit
        self.onOutput = onOutput
        var descriptors: [Int32] = [0, 0]
        guard Darwin.pipe(&descriptors) == 0 else {
            throw MobileExecutionError.io("Could not create output pipe: \(String(cString: strerror(errno)))")
        }
        guard fcntl(descriptors[0], F_SETFL, O_NONBLOCK) == 0 else {
            Darwin.close(descriptors[0])
            Darwin.close(descriptors[1])
            throw MobileExecutionError.io("Could not configure command output polling")
        }
        readHandle = FileHandle(fileDescriptor: descriptors[0], closeOnDealloc: true)
        writeDescriptor = descriptors[1]
        DispatchQueue.global(qos: .utility).async { [weak self] in
            self?.drain()
        }
    }

    func makeWriteStream() throws -> UnsafeMutablePointer<FILE> {
        let duplicate = Darwin.dup(writeDescriptor)
        guard duplicate >= 0, let stream = fdopen(duplicate, "w") else {
            if duplicate >= 0 { Darwin.close(duplicate) }
            throw MobileExecutionError.io("Could not create command output stream")
        }
        setvbuf(stream, nil, _IONBF, 0)
        return stream
    }

    func closeWriter() {
        lock.lock()
        let shouldClose = !writerClosed
        writerClosed = true
        lock.unlock()
        if shouldClose { Darwin.close(writeDescriptor) }
    }

    func finish(timeout: DispatchTime = .now() + .seconds(2)) -> BoundedOutput {
        closeWriter()
        let openAfterExit = readerDone.wait(timeout: timeout) == .timedOut
        lock.lock()
        stopRequested = true
        let output = data
        let truncated = didTruncate
        lock.unlock()
        return BoundedOutput(
            text: String(decoding: output, as: UTF8.self),
            truncated: truncated || openAfterExit,
            openAfterExit: openAfterExit
        )
    }

    private func drain() {
        // The reader owns descriptor closure; never close a descriptor while
        // another thread is blocked on it. See yy ISHShellExecutor teardown.
        defer {
            try? readHandle.close()
            readerDone.signal()
        }
        var descriptor = pollfd(fd: readHandle.fileDescriptor, events: Int16(POLLIN), revents: 0)
        var buffer = [UInt8](repeating: 0, count: 8 * 1024)
        while true {
            lock.lock()
            let stopped = stopRequested
            lock.unlock()
            if stopped { break }
            let ready = Darwin.poll(&descriptor, 1, 100)
            if ready < 0 {
                if errno == EINTR { continue }
                break
            }
            if ready == 0 { continue }
            if descriptor.revents & Int16(POLLNVAL) != 0 { break }
            let count = Darwin.read(descriptor.fd, &buffer, buffer.count)
            if count < 0 {
                if errno == EINTR || errno == EAGAIN { continue }
                break
            }
            if count == 0 { break }
            lock.lock()
            if stopRequested { lock.unlock(); break }
            let remaining = max(0, limit - data.count)
            if remaining > 0 { data.append(contentsOf: buffer.prefix(min(remaining, count))) }
            if count > remaining { didTruncate = true }
            lock.unlock()
            if remaining > 0 { onOutput?(Data(buffer.prefix(min(remaining, count)))) }
        }
    }

    deinit {
        closeWriter()
    }
}

final class TemporaryInput {
    private var stream: UnsafeMutablePointer<FILE>?
    let fileDescriptor: Int32

    init(data: Data?) throws {
        guard let file = tmpfile() else {
            throw MobileExecutionError.io("Could not create the command input file")
        }
        stream = file
        if let data, !data.isEmpty {
            let written = data.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.baseAddress else { return 0 }
                return fwrite(base, 1, buffer.count, file)
            }
            guard written == data.count else {
                fclose(file)
                stream = nil
                throw MobileExecutionError.io("Could not prepare command input")
            }
        }
        rewind(file)
        fileDescriptor = fileno(file)
    }

    func duplicateStream() throws -> UnsafeMutablePointer<FILE> {
        let duplicate = Darwin.dup(fileDescriptor)
        guard duplicate >= 0, let file = fdopen(duplicate, "r") else {
            if duplicate >= 0 { Darwin.close(duplicate) }
            throw MobileExecutionError.io("Could not duplicate command input")
        }
        return file
    }

    func close() {
        if let stream {
            fclose(stream)
            self.stream = nil
        }
    }

    deinit {
        close()
    }
}
