use crate::error::{AppError, ErrorCode};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Holds the currently opened workspace root. `None` until a folder is opened.
#[derive(Default)]
pub struct Workspace(pub Mutex<Option<PathBuf>>);

impl Workspace {
    pub fn set_root(&self, root: PathBuf) {
        *self.0.lock().unwrap() = Some(root);
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().clone()
    }
}

/// Validates that `candidate` is inside the workspace `root`, returning a
/// normalized absolute path. Rejects traversal outside the root.
pub fn resolve_in_workspace(root: &Path, candidate: &str) -> Result<PathBuf, AppError> {
    let root = normalize(root);
    let candidate_path = normalize(Path::new(candidate));
    if candidate_path.starts_with(&root) {
        Ok(candidate_path)
    } else {
        Err(AppError::new(
            ErrorCode::OutsideWorkspace,
            format!("path {candidate} is outside the workspace"),
        ))
    }
}

/// Lexically normalizes a path (resolves `.` and `..`) without touching disk.
fn normalize(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_child_path() {
        let root = Path::new("/home/u/proj");
        let resolved = resolve_in_workspace(root, "/home/u/proj/src/main.rs").unwrap();
        assert_eq!(resolved, PathBuf::from("/home/u/proj/src/main.rs"));
    }

    #[test]
    fn rejects_sibling_path() {
        let root = Path::new("/home/u/proj");
        let err = resolve_in_workspace(root, "/home/u/secret.txt").unwrap_err();
        assert_eq!(err.code, ErrorCode::OutsideWorkspace);
    }

    #[test]
    fn rejects_traversal_escape() {
        let root = Path::new("/home/u/proj");
        let err = resolve_in_workspace(root, "/home/u/proj/../secret.txt").unwrap_err();
        assert_eq!(err.code, ErrorCode::OutsideWorkspace);
    }

    #[test]
    fn root_itself_is_allowed() {
        let root = Path::new("/home/u/proj");
        assert!(resolve_in_workspace(root, "/home/u/proj").is_ok());
    }
}
