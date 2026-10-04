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
        format!("{arch}-apple-ios26.0{}", if simulator { "-simulator" } else { "" })
    } else {
        format!("{arch}-apple-macosx15.0")
    };
    // SwiftPM's static product includes the UI and its package dependencies.
    // A target-specific scratch path keeps device/simulator objects isolated.
    let scratch = output.join("native-ui");
    let resource_helper = manifest_dir.join("../../../scripts/release/prepare-apple-ui-resources.py");
    println!("cargo:rerun-if-changed={}", resource_helper.display());
    {
        let status = Command::new("xcrun").args(["swift", "package", "resolve"])
            .arg("--package-path").arg(&sources)
            .arg("--scratch-path").arg(&scratch)
            .env_remove("SDKROOT")
            .status().expect("resolve pinned native UI packages");
        assert!(status.success(), "native UI dependency resolution failed");
        for operation in if ios { vec!["patch-math", "patch-inline-images"] } else { vec!["patch-keyboard", "patch-math", "patch-inline-images"] } {
            let status = Command::new("python3").arg(&resource_helper)
                .arg(operation).arg(scratch.join("checkouts"))
                .status().expect("prepare native UI resource lookup");
            assert!(status.success(), "native UI resource lookup preparation failed");
        }
    }
    let swift_args = ["swift", "build", "--configuration", "release",
        "--product", "XgentNativeUI", "--triple", &swift_target, "--sdk", sdk.trim()];
    let status = Command::new("xcrun").args(swift_args)
        .arg("--package-path").arg(&sources)
        .arg("--scratch-path").arg(&scratch)
        // Xcode exports the product SDKROOT to script phases. SwiftPM needs
        // the host macOS SDK for Package.swift; --sdk selects the iOS target.
        .env_remove("SDKROOT")
        .status().expect("compile native SwiftUI presentation");
    assert!(status.success(), "native SwiftUI presentation compilation failed");
    let binary_path = Command::new("xcrun").args(swift_args)
        .arg("--package-path").arg(&sources)
        .arg("--scratch-path").arg(&scratch).arg("--show-bin-path")
        .env_remove("SDKROOT")
        .output().expect("locate native SwiftUI static product");
    assert!(binary_path.status.success(), "locate native SwiftUI static product failed");
    let binary_path = String::from_utf8(binary_path.stdout).expect("SwiftPM binary path");
    assert!(std::path::Path::new(binary_path.trim()).join("libXgentNativeUI.a").is_file(),
        "SwiftPM did not produce the native UI static archive");
    let status = Command::new("python3").arg(&resource_helper)
        .arg("copy").arg(binary_path.trim()).arg(manifest_dir.join("native/apple-ui-bundles"))
        .status().expect("stage native UI resource bundles");
    assert!(status.success(), "native UI resource staging failed");
    println!("cargo:rustc-link-search=native={}", binary_path.trim());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk.trim());
    // Rust/cc performs the final link, so SwiftPM cannot add the toolchain's
    // compatibility archives for us. They live alongside swiftc, not in the SDK.
    let swiftc = Command::new("xcrun").args(["--find", "swiftc"])
        .output().expect("locate Swift compiler");
    assert!(swiftc.status.success(), "locate Swift compiler failed");
    let swiftc = String::from_utf8(swiftc.stdout).expect("Swift compiler path");
    let swift_usr = std::path::Path::new(swiftc.trim())
        .parent().and_then(std::path::Path::parent)
        .expect("Swift compiler is inside a toolchain usr/bin directory");
    let swift_platform = if simulator { "iphonesimulator" } else if ios { "iphoneos" } else { "macosx" };
    let compatibility_libraries = swift_usr.join("lib/swift").join(swift_platform);
    assert!(compatibility_libraries.is_dir(), "Swift compatibility libraries missing: {}", compatibility_libraries.display());
    println!("cargo:rustc-link-search=native={}", compatibility_libraries.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=XgentNativeUI");
    // SwaTexRender's SwiftPM linkedLibrary("z") is not propagated to the
    // Rust/cc consumer of this static archive (FastPNGEncoder uses zlib).
    println!("cargo:rustc-link-lib=z");
    let platform_ui = if ios { "UIKit" } else { "AppKit" };
    for framework in ["SwiftUI", platform_ui, "WebKit", "Foundation", "PhotosUI", "Photos", "UniformTypeIdentifiers", "AVFoundation", "AVKit", "PDFKit", "QuickLook", "Metal", "MetalKit", "CoreText", "CoreGraphics", "ImageIO", "QuartzCore"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    if !ios {
        println!("cargo:rustc-link-lib=framework=QuickLookUI");
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
        "-module-name", "XgentComputerUse", "-target", &format!("{arch}-apple-macosx15.0"), "-sdk", sdk.trim()])
        .args(files).arg("-o").arg(output.join("libXgentComputerUse.a"))
        .status().expect("compile built-in computer use");
    assert!(status.success(), "built-in computer-use compilation failed");
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk.trim());
    println!("cargo:rustc-link-lib=static=XgentComputerUse");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
