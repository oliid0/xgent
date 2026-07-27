import Darwin
import Foundation

struct BoundedOutput {
    let text: String
    let truncated: Bool
}

final class BoundedPOSIXPipe {
    private let limit: Int
    private let readHandle: FileHandle
    private let readerDone = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var data = Data()
    private var didTruncate = false
    private var writerClosed = false

    let writeDescriptor: Int32

    init(limit: Int = 400 * 1024) throws {
        self.limit = limit
        var descriptors: [Int32] = [0, 0]
        guard Darwin.pipe(&descriptors) == 0 else {
            throw MobileExecutionError.io("Could not create output pipe: \(String(cString: strerror(errno)))")
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
        _ = readerDone.wait(timeout: timeout)
        lock.lock()
        let output = data
        let truncated = didTruncate
        lock.unlock()
        return BoundedOutput(
            text: String(decoding: output, as: UTF8.self),
            truncated: truncated
        )
    }

    private func drain() {
        defer { readerDone.signal() }
        while true {
            do {
                guard let chunk = try readHandle.read(upToCount: 8 * 1024), !chunk.isEmpty else { break }
                lock.lock()
                let remaining = max(0, limit - data.count)
                if remaining > 0 { data.append(chunk.prefix(remaining)) }
                if chunk.count > remaining { didTruncate = true }
                lock.unlock()
            } catch {
                break
            }
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
