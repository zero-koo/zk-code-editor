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
}
