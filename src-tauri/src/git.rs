use serde::Serialize;

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
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GitChanges {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<FileDiff>,
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

/// Parses `@@ -oldStart[,n] +newStart[,n] @@` into (old_start, new_start).
fn parse_hunk_header(line: &str) -> (u32, u32) {
    let mut old_start = 0u32;
    let mut new_start = 0u32;
    for tok in line.split_whitespace() {
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn ignores_no_newline_marker() {
        let diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n\\ No newline at end of file\n";
        let files = parse_diff(diff);
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[0].additions, 1);
        assert_eq!(files[0].hunks[0].lines.len(), 2);
    }
}
