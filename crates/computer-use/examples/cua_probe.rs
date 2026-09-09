//! Diagnostic entry point for testing the production engine without a Tauri build.
//! One JSON request per line: {"operation":"get_app_state","arguments":{"app":"window:123"}}.
//! Runs locally on the interactive desktop; observations and single-use tokens
//! have exactly the same implementation and lifetime as the application.
use std::io::{self, BufRead, Write};
use serde_json::{json, Value};

fn main() {
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let response = match line.map_err(|error| error.to_string()).and_then(|line|
            serde_json::from_str::<Value>(&line).map_err(|error| error.to_string())) {
            Ok(request) => {
                let operation = request["operation"].as_str().unwrap_or("");
                xgent_computer_use::call(operation, &request["arguments"], &|| false)
            },
            Err(error) => json!({"isError":true,"content":[{"type":"text","text":error}]}),
        };
        if serde_json::to_writer(&mut output, &response).is_err()
            || writeln!(output).is_err() || output.flush().is_err() { break; }
    }
}
