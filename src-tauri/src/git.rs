use crate::error::{AppError, ErrorCode};
use crate::fs_ops::{classify_bytes, detect_file, FileContent};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, PartialEq)]
pub struct DiffLine {
    pub kind: String, // "context" | "add" | "del"
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub too_large: bool,
    pub new_text: Option<String>,
    pub old_text: Option<String>,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GitChanges {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub is_current: bool,
}

fn strip_ab(s: &str) -> Option<String> {
    if s == "/dev/null" {
        return None;
    }
    let p = s
        .strip_prefix("a/")
        .or_else(|| s.strip_prefix("b/"))
        .unwrap_or(s);
    Some(p.to_string())
}

/// Parses `@@ -oldStart[,n] +newStart[,n] @@ [context]` into (old_start, new_start).
/// Only the range section between the `@@` markers is scanned, so a trailing
/// function-context (which may begin a token with `-`/`+`) can't corrupt it.
fn parse_hunk_header(line: &str) -> (u32, u32) {
    let inner = line
        .strip_prefix("@@ ")
        .and_then(|r| r.split(" @@").next())
        .unwrap_or(line);
    let mut old_start = 0u32;
    let mut new_start = 0u32;
    for tok in inner.split_whitespace() {
        if let Some(t) = tok.strip_prefix('-') {
            old_start = t.split(',').next().unwrap_or("0").parse().unwrap_or(0);
        } else if let Some(t) = tok.strip_prefix('+') {
            new_start = t.split(',').next().unwrap_or("0").parse().unwrap_or(0);
        }
    }
    (old_start, new_start)
}

pub fn parse_diff(diff: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut cur: Option<FileDiff> = None;
    let mut old_no: u32 = 0;
    let mut new_no: u32 = 0;

    for line in diff.split('\n') {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(f) = cur.take() {
                files.push(f);
            }
            // Default path from the header's b-side. This covers mode-only
            // (chmod) entries, which emit no ---/+++/rename lines; the
            // authoritative ---/+++/rename lines below override it when present.
            let default_path = rest
                .rfind(" b/")
                .map(|i| rest[i + 3..].to_string())
                .unwrap_or_default();
            cur = Some(FileDiff {
                path: default_path,
                old_path: None,
                status: "modified".to_string(),
                additions: 0,
                deletions: 0,
                binary: false,
                too_large: false,
                new_text: None,
                old_text: None,
                hunks: Vec::new(),
            });
            continue;
        }
        let Some(f) = cur.as_mut() else { continue };

        if line.starts_with("new file mode") {
            f.status = "added".to_string();
            continue;
        }
        if line.starts_with("deleted file mode") {
            f.status = "deleted".to_string();
            continue;
        }
        if let Some(p) = line.strip_prefix("rename from ") {
            f.status = "renamed".to_string();
            f.old_path = Some(p.to_string());
            continue;
        }
        if let Some(p) = line.strip_prefix("rename to ") {
            f.status = "renamed".to_string();
            f.path = p.to_string();
            continue;
        }
        if line.starts_with("old mode")
            || line.starts_with("new mode")
            || line.starts_with("index ")
            || line.starts_with("similarity index")
            || line.starts_with("dissimilarity index")
            || line.starts_with("copy from ")
            || line.starts_with("copy to ")
        {
            continue;
        }
        if line.starts_with("Binary files") {
            f.binary = true;
            continue;
        }
        if line.starts_with("--- ") {
            continue; // old-side path; ignored (b-side default + +++ are authoritative)
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            // Authoritative new path when present (not /dev/null). For a delete
            // (+++ /dev/null) keep the b-side default from the diff --git header.
            if let Some(p) = strip_ab(rest) {
                f.path = p;
            }
            continue;
        }
        if line.starts_with("@@") {
            let (os, ns) = parse_hunk_header(line);
            old_no = os;
            new_no = ns;
            f.hunks.push(Hunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }
        if line.starts_with('\\') {
            continue; // "\ No newline at end of file"
        }
        if line.is_empty() {
            // Trailing element from split('\n'); never a real diff line.
            continue;
        }

        if let Some(h) = f.hunks.last_mut() {
            if let Some(text) = line.strip_prefix('+') {
                h.lines.push(DiffLine {
                    kind: "add".to_string(),
                    old_no: None,
                    new_no: Some(new_no),
                    text: text.to_string(),
                });
                new_no += 1;
                f.additions += 1;
            } else if let Some(text) = line.strip_prefix('-') {
                h.lines.push(DiffLine {
                    kind: "del".to_string(),
                    old_no: Some(old_no),
                    new_no: None,
                    text: text.to_string(),
                });
                old_no += 1;
                f.deletions += 1;
            } else {
                // Context line. Real git output prefixes these with a single
                // space; strip it when present, otherwise take the line as-is.
                let text = line.strip_prefix(' ').unwrap_or(line);
                h.lines.push(DiffLine {
                    kind: "context".to_string(),
                    old_no: Some(old_no),
                    new_no: Some(new_no),
                    text: text.to_string(),
                });
                old_no += 1;
                new_no += 1;
            }
        }
    }
    if let Some(f) = cur.take() {
        files.push(f);
    }
    files
}

/// Runs `git -C <root> <args>` and returns the captured output.
fn git_output(root: &str, args: &[&str]) -> Result<std::process::Output, AppError> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| AppError::new(ErrorCode::Io, format!("failed to run git: {e}")))
}

fn is_inside_repo(root: &str) -> bool {
    match git_output(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) => out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "true",
        Err(_) => false,
    }
}

fn current_branch(root: &str) -> Option<String> {
    if let Ok(out) = git_output(root, &["symbolic-ref", "--short", "HEAD"]) {
        if out.status.success() {
            let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !b.is_empty() {
                return Some(b);
            }
        }
    }
    if let Ok(out) = git_output(root, &["rev-parse", "--short", "HEAD"]) {
        if out.status.success() {
            let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !b.is_empty() {
                return Some(b);
            }
        }
    }
    None
}

fn has_head(root: &str) -> bool {
    git_output(root, &["rev-parse", "--verify", "HEAD"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Synthesizes an all-additions FileDiff for an untracked file.
fn untracked_file_diff(root: &Path, rel: &str) -> FileDiff {
    let abs = root.join(rel);
    let mut fd = FileDiff {
        path: rel.to_string(),
        old_path: None,
        status: "untracked".to_string(),
        additions: 0,
        deletions: 0,
        binary: false,
        too_large: false,
        new_text: None,
        old_text: None,
        hunks: Vec::new(),
    };
    match detect_file(&abs) {
        Ok(FileContent::Text(text)) => {
            let mut content: Vec<&str> = text.split('\n').collect();
            if matches!(content.last(), Some(&"")) {
                content.pop(); // drop the empty element from a trailing newline
            }
            let n = content.len() as u32;
            fd.additions = n;
            if n > 0 {
                let lines = content
                    .iter()
                    .enumerate()
                    .map(|(i, t)| DiffLine {
                        kind: "add".to_string(),
                        old_no: None,
                        new_no: Some(i as u32 + 1),
                        text: t.to_string(),
                    })
                    .collect();
                fd.hunks.push(Hunk {
                    header: format!("@@ -0,0 +1,{n} @@"),
                    lines,
                });
            }
        }
        Ok(FileContent::Binary) => fd.binary = true,
        Ok(FileContent::TooLarge) => fd.too_large = true,
        Err(_) => {}
    }
    fd
}

/// Parses `git worktree list --porcelain` output. Blocks are blank-line
/// separated and each starts with `worktree <path>`. Only known prefixes are
/// read; any other line (`HEAD`, `bare`, `locked`, `prunable`, …) is ignored.
/// `branch refs/heads/<name>` → Some(name); `detached` → None.
/// `is_current` is true when the block path equals `current` (a non-empty
/// `git rev-parse --show-toplevel`); both sides are git-reported, so they agree
/// even when the workspace was opened via a symlinked path.
pub fn parse_worktrees(stdout: &str, current: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;

    for line in stdout.split('\n') {
        let line = line.trim_end_matches('\r');
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(prev) = path.take() {
                let is_current = !current.is_empty() && prev == current;
                out.push(Worktree { path: prev, branch: branch.take(), is_current });
            }
            branch = None;
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
        } else if line == "detached" {
            branch = None;
        }
    }
    if let Some(prev) = path.take() {
        let is_current = !current.is_empty() && prev == current;
        out.push(Worktree { path: prev, branch, is_current });
    }
    out
}

pub fn compute_changes(root: &str) -> Result<GitChanges, AppError> {
    if !is_inside_repo(root) {
        return Ok(GitChanges {
            is_repo: false,
            branch: None,
            files: Vec::new(),
        });
    }
    let branch = current_branch(root);
    let mut files: Vec<FileDiff> = Vec::new();

    if has_head(root) {
        let out = git_output(root, &["diff", "HEAD", "--no-color", "-M"])?;
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            files.extend(parse_diff(&text));
        }
    }

    let root_path = Path::new(root);
    let out = git_output(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    if out.status.success() {
        let raw = String::from_utf8_lossy(&out.stdout);
        for rel in raw.split('\0').filter(|s| !s.is_empty()) {
            files.push(untracked_file_diff(root_path, rel));
        }
    }

    // Attach full file contents for syntax highlighting (text files only).
    for f in &mut files {
        if f.status != "deleted" {
            if let Ok(FileContent::Text(t)) = detect_file(&root_path.join(&f.path)) {
                f.new_text = Some(t);
            }
        }
        if f.status != "added" && f.status != "untracked" {
            let r = f.old_path.clone().unwrap_or_else(|| f.path.clone());
            if let Ok(out) = git_output(root, &["show", &format!("HEAD:{r}")]) {
                if out.status.success() {
                    if let FileContent::Text(t) = classify_bytes(out.stdout) {
                        f.old_text = Some(t);
                    }
                }
            }
        }
    }

    Ok(GitChanges {
        is_repo: true,
        branch,
        files,
    })
}

#[tauri::command]
pub async fn git_changes(root: String) -> Result<GitChanges, AppError> {
    tauri::async_runtime::spawn_blocking(move || compute_changes(&root))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
}

fn list_worktrees(root: &str) -> Result<Vec<Worktree>, AppError> {
    if !is_inside_repo(root) {
        return Ok(Vec::new());
    }
    let current = git_output(root, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let out = git_output(root, &["worktree", "list", "--porcelain"])?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_worktrees(&text, &current))
}

#[tauri::command]
pub async fn git_worktrees(root: String) -> Result<Vec<Worktree>, AppError> {
    tauri::async_runtime::spawn_blocking(move || list_worktrees(&root))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {:?} failed", args);
    }

    #[test]
    fn compute_changes_reports_modified_and_untracked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        // Hermetic: a global core.excludesFile could ignore u.txt, and global
        // hooks (e.g. gitleaks) could fail the commit. Local config wins and is
        // honored by compute_changes's own `git -C` calls.
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        // modify tracked + add untracked
        std::fs::write(dir.join("a.txt"), "one\nTWO\n").unwrap();
        std::fs::write(dir.join("u.txt"), "new\nfile\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.is_repo);
        let modified = changes.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(modified.status, "modified");
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 1);
        let untracked = changes.files.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
        assert!(!untracked.hunks.is_empty());
    }

    #[test]
    fn compute_changes_includes_file_contents() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "bye\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("a.txt"), "one\nTWO\n").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        std::fs::write(dir.join("u.txt"), "new\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let a = changes.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.new_text.as_deref(), Some("one\nTWO\n"));
        assert_eq!(a.old_text.as_deref(), Some("one\ntwo\n"));
        let gone = changes.files.iter().find(|f| f.path == "gone.txt").unwrap();
        assert_eq!(gone.status, "deleted");
        assert_eq!(gone.new_text, None);
        assert_eq!(gone.old_text.as_deref(), Some("bye\n"));
        let u = changes.files.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(u.new_text.as_deref(), Some("new\n"));
        assert_eq!(u.old_text, None);
    }

    #[test]
    fn compute_changes_on_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let changes = compute_changes(tmp.path().to_str().unwrap()).unwrap();
        assert!(!changes.is_repo);
        assert!(changes.files.is_empty());
    }

    #[test]
    fn list_worktrees_reports_linked_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);

        // linked worktree in a separate temp dir
        let wt = tempfile::tempdir().unwrap();
        let wt_path = wt.path().join("feature-wt");
        git(dir, &["worktree", "add", "-q", "-b", "feature", wt_path.to_str().unwrap()]);

        let wts = list_worktrees(dir.to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 2);
        let main = wts.iter().find(|w| w.branch.as_deref() == Some("main")).unwrap();
        let feat = wts.iter().find(|w| w.branch.as_deref() == Some("feature")).unwrap();
        assert!(main.is_current); // dir's --show-toplevel matches the main worktree path
        assert!(!feat.is_current);
    }

    #[test]
    fn list_worktrees_on_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let wts = list_worktrees(tmp.path().to_str().unwrap()).unwrap();
        assert!(wts.is_empty());
    }

    #[test]
    fn parses_a_simple_modification() {
        let diff = "diff --git a/src/a.ts b/src/a.ts\n\
index 111..222 100644\n\
--- a/src/a.ts\n\
+++ b/src/a.ts\n\
@@ -1,3 +1,3 @@\n\
 const x = 1\n\
-const old = 2\n\
+const neo = 2\n\
 doStuff()\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "src/a.ts");
        assert_eq!(f.status, "modified");
        assert_eq!(f.additions, 1);
        assert_eq!(f.deletions, 1);
        assert_eq!(f.hunks.len(), 1);
        let lines = &f.hunks[0].lines;
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0].kind, "context");
        assert_eq!(lines[0].old_no, Some(1));
        assert_eq!(lines[0].new_no, Some(1));
        assert_eq!(lines[1].kind, "del");
        assert_eq!(lines[1].old_no, Some(2));
        assert_eq!(lines[1].new_no, None);
        assert_eq!(lines[2].kind, "add");
        assert_eq!(lines[2].old_no, None);
        assert_eq!(lines[2].new_no, Some(2));
        assert_eq!(lines[2].text, "const neo = 2");
    }

    #[test]
    fn parses_new_and_deleted_files() {
        let diff = "diff --git a/n.txt b/n.txt\n\
new file mode 100644\n\
index 0000000..abc\n\
--- /dev/null\n\
+++ b/n.txt\n\
@@ -0,0 +1,2 @@\n\
+line one\n\
+line two\n\
diff --git a/d.txt b/d.txt\n\
deleted file mode 100644\n\
index abc..0000000\n\
--- a/d.txt\n\
+++ /dev/null\n\
@@ -1,1 +0,0 @@\n\
-gone\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "n.txt");
        assert_eq!(files[0].status, "added");
        assert_eq!(files[0].additions, 2);
        assert_eq!(files[1].path, "d.txt");
        assert_eq!(files[1].status, "deleted");
        assert_eq!(files[1].deletions, 1);
    }

    #[test]
    fn parses_rename_with_content_change() {
        let diff = "diff --git a/old.ts b/new.ts\n\
similarity index 80%\n\
rename from old.ts\n\
rename to new.ts\n\
index 111..222 100644\n\
--- a/old.ts\n\
+++ b/new.ts\n\
@@ -1,1 +1,1 @@\n\
-a\n\
+b\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "renamed");
        assert_eq!(files[0].old_path, Some("old.ts".to_string()));
        assert_eq!(files[0].path, "new.ts");
    }

    #[test]
    fn marks_binary_files() {
        let diff = "diff --git a/img.png b/img.png\n\
index 111..222 100644\n\
Binary files a/img.png and b/img.png differ\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        assert!(files[0].binary);
        assert!(files[0].hunks.is_empty());
    }

    #[test]
    fn handles_mode_only_change_and_no_count_hunk() {
        // chmod only -> no hunks, modified
        let chmod = "diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n";
        let files = parse_diff(chmod);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].path, "s.sh"); // path must come from the diff --git header
        assert!(files[0].hunks.is_empty());

        // single-line hunk with omitted counts: "@@ -1 +1 @@"
        let single = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
        let f = parse_diff(single);
        assert_eq!(f[0].hunks[0].lines[0].old_no, Some(1));
        assert_eq!(f[0].hunks[0].lines[1].new_no, Some(1));
    }

    #[test]
    fn hunk_header_ignores_trailing_context() {
        // trailing context that starts a token with '-' must not be parsed as the range
        let diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,2 +20,2 @@ -spec myfun()\n ctx\n-old\n+new\n";
        let files = parse_diff(diff);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines[0].old_no, Some(10));
        assert_eq!(lines[0].new_no, Some(20));
        assert_eq!(lines[1].old_no, Some(11)); // "-old" after one context line
        assert_eq!(lines[2].new_no, Some(21)); // "+new"
    }

    #[test]
    fn ignores_no_newline_marker() {
        let diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n\\ No newline at end of file\n";
        let files = parse_diff(diff);
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[0].additions, 1);
        assert_eq!(files[0].hunks[0].lines.len(), 2);
    }

    #[test]
    fn parses_multiple_worktrees() {
        let out = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n\
worktree /repo/wt\nHEAD def\nbranch refs/heads/feature\n\n";
        let wts = parse_worktrees(out, "/repo");
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0].path, "/repo");
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert!(wts[0].is_current);
        assert_eq!(wts[1].path, "/repo/wt");
        assert_eq!(wts[1].branch.as_deref(), Some("feature"));
        assert!(!wts[1].is_current);
    }

    #[test]
    fn parses_detached_and_ignores_unknown_lines() {
        let out = "worktree /repo\nHEAD abc\ndetached\nlocked\nprunable gitdir gone\n\n\
worktree /repo/bare\nbare\n";
        let wts = parse_worktrees(out, "");
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0].path, "/repo");
        assert_eq!(wts[0].branch, None); // detached
        assert!(!wts[0].is_current); // current is empty → nothing matches
        assert_eq!(wts[1].path, "/repo/bare");
        assert_eq!(wts[1].branch, None); // bare worktree, no branch line
    }
}
