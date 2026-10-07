import Foundation

enum AShellWasmProbe {
    // A WASI module exporting memory and _start. fd_write writes the marker
    // from an iovec in linear memory, verifying interpreter execution and IO.
    static let expectedOutput = "xgent-wasm3-ok"
    static let module = Data(base64Encoded:
        "AGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKDwENAEEBQQBBAUEIEAAaCwskAQBBAAseEAAAAA4AAAAAAAAAAAAAAHhnZW50LXdhc20zLW9r")!
}
