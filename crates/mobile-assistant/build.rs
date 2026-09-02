const COMMANDS: &[&str] = &[
    "status",
    "start_voice_input",
    "check_permissions",
    "request_permissions",
    "get_current_location",
    "list_calendar_events",
    "list_reminders",
    "create_calendar_event",
    "create_reminder",
    "compose_message",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
