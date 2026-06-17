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

pub fn write_file_impl(root: &Path, path: &str, contents: &str) -> Result<(), AppError> {
    let file = resolve_in_workspace(root, path)?;
    std::fs::write(&file, contents)?;
    Ok(())
}

#[tauri::command]
pub fn write_file(path: String, contents: String, ws: State<Workspace>) -> Result<(), AppError> {
    let root = ws
        .root()
        .ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    write_file_impl(&root, &path, &contents)
}

pub fn create_file_impl(root: &Path, path: &str) -> Result<(), AppError> {
    let file = resolve_in_workspace(root, path)?;
    if file.exists() {
        return Err(AppError::new(ErrorCode::Conflict, "file already exists"));
    }
    std::fs::write(&file, "")?;
    Ok(())
}

pub fn create_dir_impl(root: &Path, path: &str) -> Result<(), AppError> {
    let dir = resolve_in_workspace(root, path)?;
    if dir.exists() {
        return Err(AppError::new(ErrorCode::Conflict, "already exists"));
    }
    std::fs::create_dir(&dir)?;
    Ok(())
}

#[tauri::command]
pub fn create_file(path: String, ws: State<Workspace>) -> Result<(), AppError> {
    let root = ws.root().ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    create_file_impl(&root, &path)
}

#[tauri::command]
pub fn create_dir(path: String, ws: State<Workspace>) -> Result<(), AppError> {
    let root = ws.root().ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    create_dir_impl(&root, &path)
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

    #[test]
    fn writes_and_creates_if_missing() {
        let tmp = tempdir().unwrap();
        let p = tmp.path().join("new.txt");
        write_file_impl(tmp.path(), p.to_str().unwrap(), "data").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "data");
    }

    #[test]
    fn overwrites_existing() {
        let tmp = tempdir().unwrap();
        let p = tmp.path().join("e.txt");
        fs::write(&p, "old").unwrap();
        write_file_impl(tmp.path(), p.to_str().unwrap(), "new").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
    }

    #[test]
    fn create_file_rejects_existing() {
        let tmp = tempdir().unwrap();
        let p = tmp.path().join("x.txt");
        fs::write(&p, "").unwrap();
        let err = create_file_impl(tmp.path(), p.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code, ErrorCode::Conflict);
    }

    #[test]
    fn create_dir_makes_directory() {
        let tmp = tempdir().unwrap();
        let p = tmp.path().join("sub");
        create_dir_impl(tmp.path(), p.to_str().unwrap()).unwrap();
        assert!(p.is_dir());
    }
}
