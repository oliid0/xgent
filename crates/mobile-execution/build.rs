const COMMANDS: &[&str] = &[
    "status",
    "install",
    "install_toolchains",
    "list_external_workspaces",
    "pick_external_workspace",
    "remove_external_workspace",
    "run",
    "cancel",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
