use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    Permission,
    Conflict,
    Io,
    OutsideWorkspace,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind::*;
        let code = match e.kind() {
            NotFound => ErrorCode::NotFound,
            PermissionDenied => ErrorCode::Permission,
            AlreadyExists => ErrorCode::Conflict,
            _ => ErrorCode::Io,
        };
        AppError::new(code, e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_not_found_io_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "nope");
        let err: AppError = io.into();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn maps_already_exists_to_conflict() {
        let io = std::io::Error::new(std::io::ErrorKind::AlreadyExists, "dup");
        let err: AppError = io.into();
        assert_eq!(err.code, ErrorCode::Conflict);
    }

    #[test]
    fn serializes_code_as_snake_case() {
        let err = AppError::new(ErrorCode::OutsideWorkspace, "x");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"outside_workspace\""));
    }
}
