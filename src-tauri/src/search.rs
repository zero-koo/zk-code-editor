// Workspace-wide find-in-files. Walks with `ignore`, matches with ripgrep libs.

use crate::error::{AppError, ErrorCode};
use grep_regex::RegexMatcher;
use grep_regex::RegexMatcherBuilder;
use serde::Serialize;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub regex: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct LineMatch {
    pub line_number: u32,
    pub preview: String,
    pub highlight_ranges: Vec<[u32; 2]>,
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileMatches {
    pub path: String,
    pub rel_path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SearchResponse {
    pub files: Vec<FileMatches>,
    pub total_matches: usize,
    pub truncated: bool,
    pub regex_error: Option<String>,
}

/// Builds the regex pattern string from the query + options.
/// Literal queries are escaped; regex queries are used verbatim.
fn build_pattern(query: &str, opts: &SearchOptions) -> String {
    if opts.regex {
        query.to_string()
    } else {
        regex::escape(query)
    }
}

/// Builds a ripgrep matcher, or returns the regex error message on failure.
fn build_matcher(query: &str, opts: &SearchOptions) -> Result<RegexMatcher, String> {
    let pattern = build_pattern(query, opts);
    RegexMatcherBuilder::new()
        .case_insensitive(!opts.case_sensitive)
        .build(&pattern)
        .map_err(|e| e.to_string())
}

const PREVIEW_MAX_UTF16: usize = 400;
const MAX_RANGES_PER_LINE: usize = 100;

/// UTF-16 code-unit offset of a byte offset within `line` (byte offset must be on a char boundary).
fn byte_to_utf16(line: &str, byte_off: usize) -> u32 {
    let mut units = 0u32;
    for (i, ch) in line.char_indices() {
        if i >= byte_off {
            break;
        }
        units += ch.len_utf16() as u32;
    }
    units
}

/// Truncates `line` to a preview by char boundary, capped at PREVIEW_MAX_UTF16 code units.
/// Returns (preview, preview_utf16_len).
fn build_preview(line: &str) -> (String, usize) {
    let mut out = String::new();
    let mut units = 0usize;
    for ch in line.chars() {
        let w = ch.len_utf16();
        if units + w > PREVIEW_MAX_UTF16 {
            break;
        }
        out.push(ch);
        units += w;
    }
    (out, units)
}

/// Builds a LineMatch from a 1-based line number, the (newline-stripped) line text,
/// and the byte ranges of matches within that line.
pub fn process_line(line_number: u32, line: &str, match_byte_ranges: &[(usize, usize)]) -> LineMatch {
    let (preview, preview_u16) = build_preview(line);
    let mut highlight_ranges: Vec<[u32; 2]> = Vec::new();
    for (bs, be) in match_byte_ranges.iter().take(MAX_RANGES_PER_LINE) {
        let s = byte_to_utf16(line, *bs);
        let e = byte_to_utf16(line, *be);
        // preview is a prefix of the line, so line-relative offsets == preview-relative offsets,
        // clipped to the preview length; drop matches starting beyond the preview.
        if (s as usize) < preview_u16 {
            let he = (e as usize).min(preview_u16) as u32;
            if he > s {
                highlight_ranges.push([s, he]);
            }
        }
    }
    let (match_start, match_end) = match_byte_ranges
        .first()
        .map(|(bs, be)| (byte_to_utf16(line, *bs), byte_to_utf16(line, *be)))
        .unwrap_or((0, 0));
    LineMatch { line_number, preview, highlight_ranges, match_start, match_end }
}

use crate::fs_ops::MAX_TEXT_BYTES;
use grep_matcher::Matcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use std::path::Path;

const MAX_FILES: usize = 1000;
const MAX_TOTAL_MATCHES: usize = 5000;
const MAX_PER_FILE: usize = 500;

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// Core search: walks `root`, returns file-grouped matches. Pure w.r.t. Tauri.
pub fn search_impl(root: &Path, query: &str, opts: &SearchOptions) -> SearchResponse {
    if query.trim().is_empty() {
        return SearchResponse { files: vec![], total_matches: 0, truncated: false, regex_error: None };
    }
    let matcher = match build_matcher(query, opts) {
        Ok(m) => m,
        Err(msg) => {
            return SearchResponse { files: vec![], total_matches: 0, truncated: false, regex_error: Some(msg) }
        }
    };

    let mut files: Vec<FileMatches> = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let walker = WalkBuilder::new(root)
        .require_git(false)
        .sort_by_file_name(|a, b| a.cmp(b))
        .build();

    for result in walker {
        if total_matches >= MAX_TOTAL_MATCHES {
            truncated = true;
            break;
        }
        if files.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_TEXT_BYTES {
                continue;
            }
        }
        let path = entry.path();
        let mut line_matches: Vec<LineMatch> = Vec::new();
        let remaining_total = MAX_TOTAL_MATCHES - total_matches;
        let file_cap = MAX_PER_FILE.min(remaining_total);

        let search_result = searcher.search_path(
            &matcher,
            path,
            UTF8(|lnum, line| {
                let trimmed = line.strip_suffix('\n').unwrap_or(line);
                let trimmed = trimmed.strip_suffix('\r').unwrap_or(trimmed);
                let mut byte_ranges: Vec<(usize, usize)> = Vec::new();
                let _ = matcher.find_iter(trimmed.as_bytes(), |m| {
                    byte_ranges.push((m.start(), m.end()));
                    true
                });
                if !byte_ranges.is_empty() {
                    line_matches.push(process_line(lnum as u32, trimmed, &byte_ranges));
                }
                // stop this file once its cap is reached
                Ok(line_matches.len() < file_cap)
            }),
        );
        // a non-UTF8 / unreadable file errors here — just skip it
        if search_result.is_err() {
            continue;
        }
        if line_matches.len() >= file_cap && file_cap == MAX_PER_FILE {
            truncated = true;
        }
        if !line_matches.is_empty() {
            total_matches += line_matches.len();
            files.push(FileMatches {
                path: path.to_string_lossy().into_owned(),
                rel_path: rel_path(root, path),
                matches: line_matches,
            });
        }
    }

    SearchResponse { files, total_matches, truncated, regex_error: None }
}

use crate::workspace::Workspace;
use tauri::State;

#[tauri::command]
pub async fn search_workspace(
    query: String,
    opts: SearchOptions,
    ws: State<'_, Workspace>,
) -> Result<SearchResponse, AppError> {
    let root = ws
        .root()
        .ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    // Run the blocking filesystem walk off the IPC worker thread.
    tauri::async_runtime::spawn_blocking(move || search_impl(&root, &query, &opts))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_literal_queries() {
        let p = build_pattern("a.b(c)", &SearchOptions { case_sensitive: true, regex: false });
        assert_eq!(p, regex::escape("a.b(c)"));
        assert!(p.contains("\\."));
    }

    #[test]
    fn regex_query_is_verbatim() {
        let p = build_pattern("a.+b", &SearchOptions { case_sensitive: true, regex: true });
        assert_eq!(p, "a.+b");
    }

    #[test]
    fn invalid_regex_returns_error() {
        let err = build_matcher("(", &SearchOptions { case_sensitive: true, regex: true });
        assert!(err.is_err());
    }

    #[test]
    fn valid_matcher_builds() {
        assert!(build_matcher("foo", &SearchOptions { case_sensitive: false, regex: false }).is_ok());
    }

    #[test]
    fn utf16_offsets_account_for_multibyte() {
        // "héllo" — é is 2 bytes UTF-8 but 1 UTF-16 unit. Match "llo" starts at byte 3.
        let line = "héllo";
        // byte offsets: h=0, é=1..3, l=3, l=4, o=5
        assert_eq!(byte_to_utf16(line, 3), 2); // h + é = 2 UTF-16 units
        assert_eq!(byte_to_utf16(line, 6), 5); // whole string = 5 units
    }

    #[test]
    fn process_line_multibyte_ranges() {
        // match "llo" in "héllo": byte range (3,6) → UTF-16 (2,5)
        let lm = process_line(7, "héllo", &[(3, 6)]);
        assert_eq!(lm.preview, "héllo");
        assert_eq!(lm.match_start, 2);
        assert_eq!(lm.match_end, 5);
        assert_eq!(lm.highlight_ranges, vec![[2, 5]]);
        assert_eq!(lm.line_number, 7);
    }

    #[test]
    fn preview_caps_long_lines() {
        let long = "x".repeat(1000);
        let (preview, units) = build_preview(&long);
        assert_eq!(units, PREVIEW_MAX_UTF16);
        assert_eq!(preview.chars().count(), PREVIEW_MAX_UTF16);
    }

    #[test]
    fn highlight_dropped_when_match_beyond_preview() {
        // match near end of a >cap line is dropped from highlight but match_start still set
        let long = format!("{}MATCH", "x".repeat(500));
        let start = 500;
        let lm = process_line(1, &long, &[(start, start + 5)]);
        assert!(lm.highlight_ranges.is_empty());
        assert_eq!(lm.match_start, 500);
    }

    use std::fs;
    use tempfile::tempdir;

    fn opts(cs: bool, rx: bool) -> SearchOptions {
        SearchOptions { case_sensitive: cs, regex: rx }
    }

    #[test]
    fn finds_matches_grouped_by_file() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "hello world\nbye").unwrap();
        fs::write(tmp.path().join("b.txt"), "no match here").unwrap();
        let resp = search_impl(tmp.path(), "hello", &opts(false, false));
        assert_eq!(resp.files.len(), 1);
        assert_eq!(resp.files[0].matches[0].line_number, 1);
        assert_eq!(resp.total_matches, 1);
        assert!(!resp.truncated);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "stuff").unwrap();
        let resp = search_impl(tmp.path(), "   ", &opts(false, false));
        assert!(resp.files.is_empty());
    }

    #[test]
    fn respects_gitignore() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(tmp.path().join("ignored.txt"), "secret").unwrap();
        fs::write(tmp.path().join("kept.txt"), "secret").unwrap();
        let resp = search_impl(tmp.path(), "secret", &opts(false, false));
        let names: Vec<&str> = resp.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(names.contains(&"kept.txt"));
        assert!(!names.iter().any(|n| n.contains("ignored.txt")));
    }

    #[test]
    fn skips_binary_files() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("bin.dat"), [0u8, b's', b'e', b'c', 0u8]).unwrap();
        fs::write(tmp.path().join("ok.txt"), "sec").unwrap();
        let resp = search_impl(tmp.path(), "sec", &opts(false, false));
        let names: Vec<&str> = resp.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(names, vec!["ok.txt"]);
    }

    #[test]
    fn case_insensitive_by_default() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "Hello").unwrap();
        assert_eq!(search_impl(tmp.path(), "hello", &opts(false, false)).total_matches, 1);
        assert_eq!(search_impl(tmp.path(), "hello", &opts(true, false)).total_matches, 0);
    }

    #[test]
    fn invalid_regex_sets_error() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let resp = search_impl(tmp.path(), "(", &opts(true, true));
        assert!(resp.regex_error.is_some());
        assert!(resp.files.is_empty());
    }
}
