# zk-code-editor 설계 문서

- 작성일: 2026-06-17
- 상태: 설계 확정 (구현 계획 작성 전)

## 1. 개요

직접 만들어 매일 쓸 수 있는 경량 코드 에디터(IDE). 첫 버전은 핵심 4기둥에 집중한다.

- **뷰어**: 파일 내용 표시
- **편집**: 텍스트 편집 + 명시적 저장
- **구문 강조**: 언어별 syntax highlighting
- **파일 탐색기**: 폴더 트리 + 기본 파일 조작

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|------|------|------|
| 런타임 | **Tauri v2** (Rust 백엔드 + 웹 프론트) | 경량, 빠른 시작, 자연스러운 로컬 파일시스템 접근, 작은 배포 파일. v2 기준(capability/ACL 권한 모델, 플러그인 기반 다이얼로그) |
| 프론트엔드 | **React + TypeScript** | 풍부한 생태계, 기존 React/Storybook 워크플로우와 일관 |
| 에디터 코어 | **CodeMirror 6** | 가볍고 모듈식, Lezer 기반 정확한 하이라이팅, Tauri 경량 철학과 부합 |
| 상태관리 | **Zustand** | 워크스페이스/탭/dirty 상태를 적은 보일러플레이트로 관리 |

## 3. 아키텍처

Tauri의 2계층 구조를 따른다.

### 3.1 Rust 백엔드 (`src-tauri/`)

파일시스템 작업을 `#[tauri::command]`로 노출한다. 모든 명령은 `Result<T, AppError>`를 반환해 에러를 프론트로 전달한다(아래 에러 타입 참고).

| 명령 | 시그니처 | 설명 |
|------|----------|------|
| `read_dir` | `(path: String) -> Result<Vec<DirEntry>, AppError>` | 디렉토리 엔트리 목록 (트리 펼칠 때 lazy 호출) |
| `read_file` | `(path: String) -> Result<FileContent, AppError>` | 파일 내용. 바이너리/대용량은 `FileContent`로 구분해 반환(에러 아님) |
| `write_file` | `(path: String, contents: String) -> Result<(), AppError>` | 저장 (없으면 생성, create-if-missing) |
| `create_file` | `(path: String) -> Result<(), AppError>` | 빈 파일 생성 (이미 있으면 에러) |
| `create_dir` | `(path: String) -> Result<(), AppError>` | 폴더 생성 |
| `rename` | `(from: String, to: String) -> Result<(), AppError>` | 이름 변경/이동 |
| `delete` | `(path: String) -> Result<(), AppError>` | 파일/폴더 삭제 |

- `DirEntry` = `{ name: String, path: String, is_dir: bool }`
- `FileContent` = `{ kind: "text" | "binary" | "too_large", text: Option<String> }` — "binary"/"too_large"는 정상 응답으로 프론트가 placeholder를 띄움(토스트 에러와 구분).
- `AppError` = `{ code: "not_found" | "permission" | "conflict" | "io" | "outside_workspace", message: String }` — 프론트가 코드로 분기.

**폴더 열기 다이얼로그**: 커스텀 명령을 만들지 않고 `tauri-plugin-dialog`의 `open({ directory: true })`를 프론트에서 직접 호출한다. (플러그인 설치 + v2 capability 등록 필요)

**경로 보안 / FS 스코프**: 위 명령들은 인자로 받은 경로가 **현재 열린 워크스페이스 루트 하위인지 검증**한 뒤 동작한다(벗어나면 `outside_workspace` 에러). v2 capability에는 FS 접근 권한과 dialog 권한을 등록한다. 동적 스코프(열린 폴더에 한정)는 가능 범위에서 적용하고, 최종 방어선은 이 루트 검증 로직이다.

**인코딩**: 텍스트는 UTF-8로 취급한다. 디코딩 실패(비-UTF8) 파일은 바이너리로 간주해 `FileContent { kind: "binary" }`로 반환한다.

### 3.2 프론트엔드 (React + TS)

- **Zustand 스토어**: 워크스페이스 루트 / 열린 탭 메타데이터(경로·언어·dirty) / 활성 탭 / 트리 펼침 상태. **문서 본문 텍스트는 store에 두지 않는다.**
- **문서 소유권**: 각 탭의 실제 텍스트는 **CodeMirror 6의 `EditorState`가 소유**한다. 키 입력마다 store로 동기화하지 않는다. dirty는 CM의 변경 이벤트로 감지하고, 저장 성공 시 "마지막 저장 시점"을 기준선으로 갱신한다(저장 상태로 되돌리는 undo 시 dirty 해제).
- **탭 식별자**: 절대 경로를 키로 사용. 같은 파일은 하나의 탭으로 모인다.
- **언어 전환**: CM6 `Compartment`로 언어 확장을 재구성한다.
- CodeMirror 6 + 다크 테마 1종, 확장자 → 언어 확장 매핑

## 4. UI / 레이아웃

VS Code 스타일 (액티비티 바 포함). 좌→우 배치.

```
App (레이아웃 셸)
├── ActivityBar        — 맨 왼쪽 아이콘 바 (지금은 Explorer 토글, 추후 확장 슬롯)
├── Sidebar
│   └── FileExplorer
│       └── FileTreeNode (재귀)  — 폴더 펼침/접힘, 우클릭 컨텍스트 메뉴(생성/이름변경/삭제)
├── EditorArea
│   ├── TabBar         — 열린 파일 탭, dirty 표시(●), 닫기(×)
│   └── EditorPane     — CodeMirror 6 래퍼 (활성 탭 내용 표시/편집)
└── StatusBar          — 현재 파일 경로·언어·커서 위치 (최소 구현)
```

각 컴포넌트는 props/store로만 소통하고 독립적으로 테스트 가능하게 둔다.

## 5. 기능 범위

### 5.1 파일 탐색기

- 폴더 열기 + 트리 탐색 + 파일 열기
- **기본 파일 조작**: 파일/폴더 생성·이름변경·삭제 (우클릭 컨텍스트 메뉴)

### 5.2 저장 모델

- 명시적 저장 (`Cmd/Ctrl+S`)
- 수정된 탭에 dirty 점(●) 표시
- 미저장 상태로 탭/앱 닫으면 확인 다이얼로그

### 5.3 구문 강조 지원 언어

- 웹 세트: JS / TS / JSX / TSX (`@codemirror/lang-javascript`), JSON, HTML, CSS, Markdown — 공식 `@codemirror/lang-*` 패키지
- 백엔드: Python (`lang-python`), Rust (`lang-rust`), YAML (`lang-yaml`) — 공식 패키지. **Go / Shell 은 공식 lang 패키지가 없어 `@codemirror/legacy-modes`** 로 처리한다.
- 구현 시 각 언어 패키지의 실제 존재 여부를 확인하고, legacy-mode 대상은 별도 어댑터로 묶는다.

## 6. 데이터 흐름

1. **폴더 열기** → `tauri-plugin-dialog`의 `open({ directory: true })` → 루트 경로를 store에 저장
2. 루트에 대해 `read_dir` → 트리 렌더 (폴더 펼칠 때 해당 경로 `read_dir` lazy 호출). **트리 펼침 상태는 store에 보존**해, 새로고침 시 펼친 폴더가 접히지 않게 한다.
3. **파일 클릭** → `read_file` → `kind`가 text면 탭 생성/활성화 → CodeMirror에 내용 + 확장자 기반 언어 마운트. binary/too_large면 placeholder 표시.
4. **편집** → CM 변경 이벤트로 해당 탭 dirty = true
5. **`Cmd/Ctrl+S`** → `write_file` → 성공 시 dirty = false (저장 기준선 갱신)
6. **탐색기 파일 조작** (컨텍스트 메뉴) → 해당 Rust 명령 실행 → 영향받은 디렉토리만 새로고침(펼침 상태 유지). 조작 대상이 **열린 탭과 관련된 경우**:
   - 열린 파일 **이름변경/이동** → 해당 탭의 경로·식별자를 새 경로로 갱신
   - 열린 파일 **삭제**(또는 상위 폴더 삭제) → 해당 탭들을 닫음. dirty면 닫기 전 확인 다이얼로그

## 7. 에러 처리

- **공통**: 명령 실패(`AppError`) 시 `code`로 분기해 toast/알림 표시(`permission` / `not_found` / `io` / `outside_workspace`). 에디터 상태는 보존.
- **바이너리/대용량 가드**: `read_file`은 비텍스트(널 바이트/비-UTF8) 또는 임계값(예: 5MB) 초과 시 **에러가 아니라** `FileContent { kind: "binary" | "too_large" }`로 반환 → 프론트가 placeholder("미리보기 불가") 표시. 실제 에러(권한 등)와 구분된다.
- **미저장 변경 가드**: dirty 탭 닫기/앱 종료 시, 그리고 열린 dirty 파일이 탐색기에서 삭제될 때 확인 다이얼로그.
- **파일 조작 충돌**: 중복 이름 생성/이름변경 시 `conflict` 에러로 명확히 안내. 삭제는 확인 후 실행.
- **외부 변경**: 초기엔 디스크 변경 자동 감지 안 함 (파일 와처는 non-goal).

> **알려진 제약(MVP)**: 펼쳐진 하위 폴더 내부에서의 생성/삭제/이름변경은 루트 트리만 새로고침하므로, 중첩 변경이 즉시 반영되지 않아 해당 폴더를 접었다 펴야 할 수 있다(트리 펼침 상태가 노드 로컬이기 때문).

## 8. 테스트 전략

- **프론트엔드**: Storybook `play()` + `composeStories` + vitest. Tauri 명령은 모킹해서 컴포넌트 단위 테스트 — FileTreeNode 펼침/접힘, TabBar dirty/닫기, EditorPane 마운트·언어 적용.
- **Rust**: 임시 디렉토리(`tempfile`)로 fs 명령 단위 테스트 — 정상·에러 경로.
- **통합(수동)**: `tauri dev`로 실제 폴더 열기 → 편집 → 저장 → 파일 조작 플로우 확인.

## 9. 범위 밖 (Non-Goals, 초기 버전)

명확히 하지 않을 것 — 나중 확장 여지로 남긴다.

- LSP / 자동완성 / IntelliSense
- 통합 터미널, Git 연동, 디버거
- 전역 검색·바꾸기 패널, 파일 와처(외부 변경 자동 반영)
- 확장(플러그인) 시스템, 설정 UI, 멀티 워크스페이스
- 분할 편집(split view), 미니맵
