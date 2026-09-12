fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let package_json = std::path::Path::new(&manifest_dir)
        .join("..")
        .join("package.json");
    println!("cargo:rerun-if-changed={}", package_json.display());
    println!("cargo:rerun-if-env-changed=XGENT_APP_VERSION");

    let app_version = std::env::var("XGENT_APP_VERSION")
        .ok()
        .map(|version| version.trim().to_owned())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| {
            let package_json_text =
                std::fs::read_to_string(&package_json).expect("read app package.json for version");
            let package_json_value: serde_json::Value = serde_json::from_str(&package_json_text)
                .expect("parse app package.json for version");
            package_json_value
                .get("version")
                .and_then(serde_json::Value::as_str)
                .filter(|version| !version.trim().is_empty())
                .expect("app package.json version must be a non-empty string")
                .trim()
                .to_owned()
        });
    println!("cargo:rustc-env=XGENT_APP_VERSION={app_version}");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        link_computer_use(std::path::Path::new(&manifest_dir));
    }
    if target_os == "macos" || target_os == "ios" {
        link_native_ui(std::path::Path::new(&manifest_dir));
    }
    let is_windows_msvc = target_os == "windows"
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if is_windows_msvc {
        let manifest_path = std::path::Path::new(
            &std::env::var("OUT_DIR").expect("OUT_DIR for Windows app manifest"),
        )
        .join("windows-app-manifest.xml");
        std::fs::write(
            &manifest_path,
            r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#,
        )
        .expect("write Windows app manifest");
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("run Tauri build script");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
    } else {
        tauri_build::build();
    }
}

// Uses the same in-process Swift linkage as the existing computer-use module.
// Link into Rust on both Apple targets: the iOS cdylib must resolve this symbol
// before Xcode links the final app, not from a later application source phase.
fn link_native_ui(manifest_dir: &std::path::Path) {
    use std::process::Command;
    let sources = manifest_dir.join("native/apple-ui");
    println!("cargo:rerun-if-changed={}", sources.display());
    let output = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let target = std::env::var("TARGET").expect("Rust target");
    let ios = target.contains("apple-ios");
    let simulator = target.ends_with("-sim") || (ios && target.starts_with("x86_64"));
    let sdk_name = if simulator { "iphonesimulator" } else if ios { "iphoneos" } else { "macosx" };
    let sdk = Command::new("xcrun").args(["--sdk", sdk_name, "--show-sdk-path"])
        .output().expect("locate Apple SDK");
    assert!(sdk.status.success(), "locate Apple SDK failed");
    let sdk = String::from_utf8(sdk.stdout).expect("SDK path");
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture");
    let arch = if arch == "aarch64" { "arm64" } else { &arch };
    let swift_target = if ios {
        format!("{arch}-apple-ios16.0{}", if simulator { "-simulator" } else { "" })
    } else {
        format!("{arch}-apple-macosx14.0")
    };
    let mut files: Vec<_> = std::fs::read_dir(&sources).expect("native SwiftUI sources")
        .map(|entry| entry.expect("SwiftUI source").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "swift")).collect();
    files.sort();
    let status = Command::new("xcrun").args(["swiftc", "-swift-version", "5", "-O", "-emit-library", "-static",
        "-module-name", "XgentNativeUI", "-target", &swift_target, "-sdk", sdk.trim()])
        .args(files).arg("-o").arg(output.join("libXgentNativeUI.a"))
        .status().expect("compile native SwiftUI presentation");
    assert!(status.success(), "native SwiftUI presentation compilation failed");
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk.trim());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=XgentNativeUI");
    let platform_ui = if ios { "UIKit" } else { "AppKit" };
    for framework in ["SwiftUI", platform_ui, "WebKit", "Foundation", "PhotosUI", "Photos", "UniformTypeIdentifiers", "AVFoundation"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

// Compile the app's Swift implementation into the main executable, never a
// separately distributed driver. This runs only as part of the macOS app build.
fn link_computer_use(manifest_dir: &std::path::Path) {
    use std::process::Command;
    let sources = manifest_dir.join("native/computer-use/macos");
    println!("cargo:rerun-if-changed={}", sources.display());
    let output = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let sdk = Command::new("xcrun").args(["--sdk", "macosx", "--show-sdk-path"])
        .output().expect("locate macOS SDK");
    assert!(sdk.status.success(), "locate macOS SDK failed");
    let sdk = String::from_utf8(sdk.stdout).expect("SDK path");
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture");
    let arch = if arch == "aarch64" { "arm64" } else { &arch };
    let mut files: Vec<_> = std::fs::read_dir(&sources).expect("Swift sources")
        .map(|entry| entry.expect("Swift source").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "swift")).collect();
    files.sort();
    let status = Command::new("xcrun").args(["swiftc", "-swift-version", "5", "-O", "-emit-library", "-static",
        "-module-name", "XgentComputerUse", "-target", &format!("{arch}-apple-macosx14.0"), "-sdk", sdk.trim()])
        .args(files).arg("-o").arg(output.join("libXgentComputerUse.a"))
        .status().expect("compile built-in computer use");
    assert!(status.success(), "built-in computer-use compilation failed");
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk.trim());
    println!("cargo:rustc-link-lib=static=XgentComputerUse");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
