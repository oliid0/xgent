import Foundation

@main
struct ComputerUseArgumentRegression {
    static func main() throws {
        let decoded = try JSONSerialization.jsonObject(with: Data("{\"bool\":true,\"fraction\":2.5,\"index\":7,\"overflow\":9223372036854775808}".utf8)) as! [String: Any]
        precondition(normalizedElementIndexArgument(decoded["bool"]) == nil)
        precondition(normalizedElementIndexArgument(decoded["fraction"]) == nil)
        precondition(normalizedElementIndexArgument(decoded["overflow"]) == nil)
        precondition(normalizedElementIndexArgument(Double(Int.max)) == nil)
        precondition(normalizedElementIndexArgument(Double.infinity) == nil)
        precondition(normalizedElementIndexArgument(Double.nan) == nil)
        precondition(normalizedElementIndexArgument(decoded["index"]) == "7")
        precondition(normalizedElementIndexArgument(Int.max) == String(Int.max))
        precondition(normalizedElementIndexArgument(Int.min) == String(Int.min))
        precondition(normalizedElementIndexArgument("AX:7") == "AX:7")
        precondition(normalizedElementIndexArgument("") == nil)
        let invalid: [Any] = [decoded["bool"]!, decoded["fraction"]!, decoded["overflow"]!, Double(Int.max), Double.infinity, Double.nan, 0, -1]
        for value in invalid {
            do {
                _ = try computerUsePositiveInteger(value, key: "click_count")
                preconditionFailure("Invalid CUA argument was accepted: \(value)")
            } catch ComputerUseError.invalidArguments(_) { }
        }
        let count = try computerUsePositiveInteger(decoded["index"]!, key: "click_count")
        let maximum = try computerUsePositiveInteger(Int.max, key: "max_tree_nodes")
        precondition(count == 7 && maximum == Int.max)
        print("Computer-use integer/JSON boundary regressions passed")
    }
}
