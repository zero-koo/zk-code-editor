use crate::error::{AppError, ErrorCode};
use crate::workspace::{resolve_in_workspace, Workspace};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Reads the immediate children of `path`. Directories sort before files,
/// each group alphabetically.
pub fn read_dir_impl(root: &Path, path: &str) -> Result<Vec<DirEntry>, AppError> {
    let dir = resolve_in_workspace(root, path)?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_dir(path: String, ws: State<Workspace>) -> Result<Vec<DirEntry>, AppError> {
    let root = ws
        .root()
        .ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    read_dir_impl(&root, &path)
}

const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024; // 5 MB

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind", content = "text")]
pub enum FileContent {
    Text(String),
    Binary,
    TooLarge,
}

pub fn read_file_impl(root: &Path, path: &str) -> Result<FileContent, AppError> {
    let file = resolve_in_workspace(root, path)?;
    let meta = std::fs::metadata(&file)?;
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge);
    }
    let bytes = std::fs::read(&file)?;
    if bytes.contains(&0) {
        return Ok(FileContent::Binary);
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileContent::Text(text)),
        Err(_) => Ok(FileContent::Binary),
    }
}

#[tauri::command]
pub fn read_file(path: String, ws: State<Workspace>) -> Result<FileContent, AppError> {
    let root = ws
        .root()
        .ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    read_file_impl(&root, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_dirs_before_files_sorted() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("zdir")).unwrap();
        fs::write(root.join("a.txt"), "x").unwrap();
        fs::write(root.join("b.txt"), "y").unwrap();

        let entries = read_dir_impl(root, root.to_str().unwrap()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zdir", "a.txt", "b.txt"]);
        assert!(entries[0].is_dir);
    }

    #[test]
    fn rejects_path_outside_workspace() {
        let tmp = tempdir().unwrap();
        let err = read_dir_impl(tmp.path(), "/etc").unwrap_err();
        assert_eq!(err.code, ErrorCode::OutsideWorkspace);
    }

    #[test]
    fn reads_text_file() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        let c = read_file_impl(tmp.path(), tmp.path().join("a.txt").to_str().unwrap()).unwrap();
        assert_eq!(c, FileContent::Text("hello".into()));
    }

    #[test]
    fn detects_binary_via_null_byte() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("b.bin"), [0u8, 1, 2, 3]).unwrap();
        let c = read_file_impl(tmp.path(), tmp.path().join("b.bin").to_str().unwrap()).unwrap();
        assert_eq!(c, FileContent::Binary);
    }
}
