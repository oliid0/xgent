import Darwin
import Foundation
import ios_system

private typealias PythonEntryPoint = @convention(c) (
    Int32, UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Int32
private typealias PythonSetPath = @convention(c) (UnsafePointer<wchar_t>?) -> Void

// The pinned CPython 3.9 archive discovers extensions as a-Shell frameworks,
// rather than conventional lib-dynload files. Its C loader also derives the
// framework root from the first /Library in Py_GetPrefix(), which is wrong
// for our nested data root and for CoreSimulator paths. Py_SetPath supplies
// explicit stdlib paths and leaves that C prefix empty, so the upstream loader
// uses APPDIR/Frameworks. Installation links that directory to signed binaries.
enum AShellPythonRuntime {
    private struct Runtime {
        let handle: UnsafeMutableRawPointer
        let main: PythonEntryPoint
        let setPath: PythonSetPath
    }

    private static let runtime: Runtime? = {
        guard let frameworks = Bundle.main.privateFrameworksURL,
              let handle = dlopen(
                frameworks.appendingPathComponent("python3_ios.framework/python3_ios").path,
                RTLD_NOW | RTLD_GLOBAL
              ) else { return nil }
        guard let main = dlsym(handle, "Py_BytesMain"),
              let setPath = dlsym(handle, "Py_SetPath") else {
            dlclose(handle)
            return nil
        }
        return Runtime(
            handle: handle,
            main: unsafeBitCast(main, to: PythonEntryPoint.self),
            setPath: unsafeBitCast(setPath, to: PythonSetPath.self)
        )
    }()

    static func register() throws {
        // A direct function-pointer reference keeps the callback in the static
        // plugin archive; verify its export because replaceCommand silently
        // ignores a function stripped by the application linker.
        let callback: PythonEntryPoint = xgentPythonMain
        let address = unsafeBitCast(callback, to: UnsafeMutableRawPointer.self)
        guard let process = dlopen(nil, RTLD_NOW) else {
            throw MobileExecutionError.io("Could not access the Python command bridge")
        }
        defer { dlclose(process) }
        guard dlsym(process, "xgent_python_main") == address, runtime != nil else {
            throw MobileExecutionError.io("The bundled Python command bridge is unavailable")
        }
        replaceCommand("python3", "xgent_python_main", true)
    }

    static func run(
        argc: Int32,
        argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
    ) -> Int32 {
        guard let runtime, let home = getenv("PYTHONHOME"), let argv, argc > 0 else {
            fputs("The bundled Python runtime is not configured\n", thread_stderr ?? stderr)
            return 1
        }
        let library = String(cString: home) + "/lib/python3.9"
        var paths = [library, library + "/lib-dynload", library + "/site-packages"]
        if let pythonPath = getenv("PYTHONPATH") {
            paths.insert(contentsOf: String(cString: pythonPath).split(separator: ":").map(String.init), at: 0)
        }
        let widePath = paths.joined(separator: ":").unicodeScalars.map { wchar_t($0.value) } + [0]
        widePath.withUnsafeBufferPointer { runtime.setPath($0.baseAddress) }
        // All three public aliases use the same signed extension prefix.
        guard let name = strdup("python3_ios") else { return 1 }
        let original = argv[0]
        argv[0] = name
        defer { argv[0] = original; free(name) }
        return runtime.main(argc, argv)
    }
}

@_cdecl("xgent_python_main")
func xgentPythonMain(
    argc: Int32,
    argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?
) -> Int32 {
    AShellPythonRuntime.run(argc: argc, argv: argv)
}
