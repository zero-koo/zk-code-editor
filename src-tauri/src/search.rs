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
}
