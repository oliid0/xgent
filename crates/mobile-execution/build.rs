const COMMANDS: &[&str] = &[
    "status",
    "install",
    "install_toolchains",
    "run",
    "cancel",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
