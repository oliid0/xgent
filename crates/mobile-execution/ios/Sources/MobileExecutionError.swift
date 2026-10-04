import Foundation

enum MobileExecutionError: LocalizedError {
    case invalidRequest(String)
    case io(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .io(let message): return message
        }
    }
}
