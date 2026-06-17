mod error;
mod fs_ops;
mod search;
mod workspace;

use workspace::Workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Workspace::default())
        .invoke_handler(tauri::generate_handler![
            fs_ops::set_workspace_root,
            fs_ops::read_dir,
            fs_ops::read_file,
            fs_ops::write_file,
            fs_ops::create_file,
            fs_ops::create_dir,
            fs_ops::rename,
            fs_ops::delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
