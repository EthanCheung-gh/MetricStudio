#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    port: u16,
    child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
}

#[tauri::command]
fn get_backend_port(state: State<'_, SidecarState>) -> u16 {
    state.port
}

/// Kill the current sidecar (if any) and spawn a fresh one on the same port.
/// Used by the frontend to recover after detecting repeated /health failures (spec §3.3).
#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    stop_sidecar(&app);
    let port = app.state::<SidecarState>().port;
    start_sidecar(&app, port)
}

fn find_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn start_sidecar(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let shell = app.shell();
    // In production, the sidecar binary is bundled as `python-sidecar`.
    // In development, we spawn `python backend/main.py` from the project root.
    let (command, args): (std::borrow::Cow<str>, Vec<std::borrow::Cow<str>>) = if cfg!(dev) {
        (
            "python".into(),
            vec!["backend/main.py".into()],
        )
    } else {
        (
            "python-sidecar".into(),
            vec![],
        )
    };

    let sidecar = shell.sidecar(command).map_err(|e| e.to_string())?;
    let (_rx, child) = sidecar
        .env("METRICSTUDIO_PORT", port.to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    let state: State<'_, SidecarState> = app.state();
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

fn stop_sidecar(app: &tauri::AppHandle) {
    let state: State<'_, SidecarState> = app.state();
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn main() {
    let port = find_free_port();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            port,
            child: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            start_sidecar(&handle, port).map_err(|e| {
                eprintln!("Failed to start sidecar: {}", e);
            }).ok();
            Ok(())
        })
        .on_window_event(|app, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_sidecar(app);
            }
        })
        .invoke_handler(tauri::generate_handler![get_backend_port, restart_sidecar])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
