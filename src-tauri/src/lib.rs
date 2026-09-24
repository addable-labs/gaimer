mod credentials;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            credentials::get_credential,
            credentials::set_credential,
            credentials::delete_credential,
            credentials::import_old_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
