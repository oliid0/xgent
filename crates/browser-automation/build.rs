const COMMANDS: &[&str] = &[
    "status",
    "open_session",
    "list_sessions",
    "close_session",
    "set_viewport",
    "action",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
