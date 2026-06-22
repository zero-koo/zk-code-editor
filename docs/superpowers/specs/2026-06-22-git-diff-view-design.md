# Git 변경사항 Diff 뷰 설계 문서

- 작성일: 2026-06-22
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: 없음(첫 git 기능). 이후 git 기능들(스테이징/커밋/점프 목록/구문강조)의 토대.

## 1. 개요

현재 작업트리의 변경사항을 GitHub "Files changed" 탭처럼 **하나의 연속 unified diff**로 보여주는 읽기 전용 뷰. 액티비티바의 Source Control 아이콘으로 진입하며, 메인 영역 전체를 DiffView가 차지한다.

### 1.1 확정된 범위 (브레인스토밍)

- **대상**: 커밋 안 된 작업트리 변경 = `git diff HEAD`(staged+unstaged 통합) + untracked 파일.
- **표시**: unified(한 열), 파일별 연속 스크롤, 플레인 색상 diff(구문 강조 없음).
- **리네임 추적 포함**(`-M`): 리네임은 `old → new`로 표기.
- **읽기 전용**: 스테이징/커밋/되돌리기 없음.

### 1.2 비범위 (후속)

사이드바 변경파일 점프 목록 · 구문 강조 · 저장/포커스 시 자동 갱신 · split(side-by-side) 보기 · 브랜치-base 비교 diff · 스테이징/커밋 액션.

## 2. 아키텍처

두 레이어로 분리한다.
- **Rust(`git.rs`)**: `git` CLI를 셸 아웃해 변경사항을 구조화 JSON으로 파싱하는 단일 명령.
- **Frontend**: 그 데이터를 연속 diff로 렌더하는 `DiffView`(+ 하위 렌더 + 공유 스토어).

`git` 바이너리가 PATH에 있어야 한다(없으면 에러 상태로 표시).

## 3. Rust 백엔드

### 3.1 명령
`src-tauri/src/git.rs` 신설, `lib.rs`의 `invoke_handler`에 `git::git_changes` 등록.

```
#[tauri::command]
async fn git_changes(root: String) -> Result<GitChanges, AppError>
```
- `tauri::async_runtime::spawn_blocking`으로 git 호출(블로킹 IO).
- 모든 git 호출은 `git -C <root> ...` 형태. 비-저장소면 `GitChanges { is_repo: false, .. }` 반환(에러 아님).

### 3.2 절차
1. `git -C root rev-parse --is-inside-work-tree` → 실패/false면 `is_repo=false`로 즉시 반환.
2. `git -C root rev-parse --abbrev-ref HEAD` → 브랜치명(detached면 "HEAD" 또는 short SHA).
3. `git -C root diff HEAD --no-color -M` → 추적 파일 변경(staged+unstaged vs HEAD, 리네임 추적). stdout을 §3.4 파서로 구조화. **단, 커밋이 하나도 없는 저장소(unborn HEAD)면 HEAD가 없어 실패하므로**, 먼저 `git -C root rev-parse --verify HEAD`로 HEAD 존재를 확인하고 없으면 이 단계를 건너뛴다(스테이징된 신규 파일은 `ls-files --cached`/`diff --cached`로도 잡을 수 있으나, v1에선 unborn HEAD에서 추적 diff를 생략하고 untracked만 표시 — 신규 저장소 흔치 않음).
4. `git -C root ls-files --others --exclude-standard -z` → untracked 경로 목록. 각 파일을 읽어(기존 `fs_ops`의 텍스트/바이너리/`MAX_TEXT_BYTES` 판정 재사용) **전부-추가(add) FileDiff**로 합성. 바이너리/초대용량은 `binary`/별도 플래그로 표시하고 hunks 비움.
5. 두 목록을 합쳐 `files`로 반환(추적 변경 먼저, untracked 뒤, 각 그룹은 경로 정렬).

### 3.3 데이터 형태 (serde → JSON, camelCase)
```
GitChanges { is_repo: bool, branch: Option<String>, files: Vec<FileDiff> }

FileDiff {
  path: String,            // 새 경로(리네임/추가/수정의 b측), 삭제는 a측 경로
  old_path: Option<String>,// 리네임 시 a측 경로
  status: String,          // "modified" | "added" | "deleted" | "renamed" | "untracked"
  additions: u32,
  deletions: u32,
  binary: bool,            // 바이너리면 true, hunks 비움
  too_large: bool,         // untracked 초대용량이면 true, hunks 비움
  hunks: Vec<Hunk>,
}

Hunk {
  header: String,          // "@@ -a,b +c,d @@ <context>" 원문
  lines: Vec<DiffLine>,
}

DiffLine {
  kind: String,            // "context" | "add" | "del"
  old_no: Option<u32>,     // del/context면 Some, add면 None
  new_no: Option<u32>,     // add/context면 Some, del면 None
  text: String,            // 선행 +/-/공백 제거한 줄 내용
}
```

### 3.4 unified diff 파서
`git diff` stdout을 파일 단위로 분해한다. 인식 토큰:
- `diff --git a/<p> b/<p>` → 새 FileDiff 시작.
- `new file mode …` → status "added"(이미 인덱스에 추가된 신규). `deleted file mode …` → "deleted". `rename from <p>`/`rename to <p>` → status "renamed", old_path 설정. 그 외 → "modified".
- `Binary files … differ` → `binary=true`, hunks 없음.
- `--- a/<p>` / `+++ b/<p>`(또는 `/dev/null`) → 경로 보강.
- `@@ -oldStart[,oldCnt] +newStart[,newCnt] @@ [context]` → 새 Hunk, `old_no=oldStart`, `new_no=newStart` 카운터 시작.
- 본문 줄: ` ` context(old_no++, new_no++), `+` add(new_no++), `-` del(old_no++). `additions`/`deletions` 집계.
- `\ No newline at end of file` → 라인번호에 영향 없음(무시).

파서는 순수 함수 `parse_diff(&str) -> Vec<FileDiff>`로 분리해 단위 테스트한다.

### 3.5 에러
- git 미설치/실행 실패 → `AppError`(프론트가 에러 상태로 표시).
- 비-저장소 → 에러 아님, `is_repo=false`.

## 4. 프론트엔드

### 4.1 API / 타입
- `src/api/git.ts`: `gitChanges(root): Promise<GitChanges>` (invoke "git_changes").
- 타입은 `src/api/types.ts`에 `GitChanges/FileDiff/Hunk/DiffLine` 추가.

### 4.2 뷰 배치 / App 통합
- `workspaceStore.activeView`를 `"explorer" | "search" | "git"`로 확장.
- `ActivityBar`에 Source Control(git) 아이콘 추가. 클릭 시 `activeView="git"`.
- **`activeView === "git"`이면 메인 영역 전체가 `<DiffView>`** (TabBar·EditorPane·StatusBar 대신). v1에선 git 전용 사이드바 패널이 없으므로 사이드바는 표시하지 않는다.
- 다른 뷰(explorer/search)나 파일/탭을 선택하면 `activeView`가 바뀌어 다시 편집 화면으로 복귀.

### 4.3 상태/데이터
- `src/store/gitStore.ts`(Zustand): `{ changes: GitChanges | null, loading: bool, error: string | null, load(root): Promise<void> }`. `load`는 `gitChanges(root)` 호출 후 상태 갱신(레이스 방지 시퀀스 가드).
- `DiffView`는 git 뷰 진입 시(`activeView`가 git이 됨 + root 존재) `load(root)` 호출, 상단 새로고침 버튼으로도 호출.

### 4.4 컴포넌트
- **`DiffView`**(메인): 상단바(브랜치명 · 변경 파일 수 · 새로고침 버튼) + 본문. 상태별 렌더: loading / error / `is_repo===false`("Not a Git repository") / 변경 없음("No changes") / 파일 목록.
- 본문은 파일/헌크/줄을 **단일 행 리스트로 평탄화**해 `@tanstack/react-virtual`로 가상화(검색 패널과 동일 패턴; 거대 diff 대비). 행 종류:
  - `file-header`: 접기 chevron · 상태 배지(M/A/D/R/U) · 경로(리네임은 `old → new`) · `+N −M`.
  - `hunk-header`: `@@ … @@` 회색 줄.
  - `line`: 좌(old_no)·우(new_no) 라인번호 거터 + 내용. kind에 따라 배경(add 초록, del 빨강, context 무색)과 `+`/`−`/` ` 마커.
  - `binary`/`too-large`/`empty`(변경 없는 파일 헤더만): 안내 한 줄.
- 접기: 파일 단위 `collapsed: Set<path>`. 접힌 파일은 헤더 행만 평탄화에 포함.
- **`FileDiffSection`은 가상화 행 렌더 함수로 구현**(별도 큰 컴포넌트가 아니라 행 종류별 렌더). 행 높이 고정(헤더/헌크/줄 각 고정 px)로 고정 크기 가상화.

### 4.5 갱신 트리거 (v1)
git 뷰 진입 시 1회 + 수동 새로고침 버튼. (저장/포커스 자동 갱신은 후속.)

## 5. 에러 / 엣지
- 비-저장소: "Not a Git repository" 안내.
- 변경 없음: "No changes" 안내.
- git 실행 실패: 에러 메시지 표시 + 새로고침으로 재시도.
- 바이너리 파일: 헤더 + "Binary file not shown".
- untracked 초대용량: 헤더 + "File too large to display".
- 삭제 파일: 전부 `−` 줄(new_no 없음).
- 리네임: 헤더 `old → new`, 내용 변경 있으면 hunks 표시.
- 거대 diff: 가상화로 렌더 비용 제한.
- 커밋 없는 신규 저장소(unborn HEAD): 추적 diff 생략, untracked 파일만 표시(§3.2-3).

## 6. 테스트
- **Rust 단위(핵심)**: `parse_diff`를 대표 `git diff` 출력으로 검증 — 단순 수정(다중 헌크), 신규 파일, 삭제 파일, 리네임(내용 변경 유/무), 바이너리, `\ No newline at end of file`, 라인번호 카운팅/additions·deletions 집계.
- **프론트**: 목 `GitChanges`로 `DiffView` 렌더 — loading/error/비-저장소/변경없음/파일들; 파일 접기 토글; add/del/context 줄 스타일·라인번호; 바이너리/too-large 안내. 가상화는 기존 jsdom 스텁(ResizeObserver·`.zk-scroll` offsetHeight) 재사용.
- **수동**: 실제 저장소에서 `tauri dev` — 수정/추가/삭제/리네임/untracked/바이너리, 거대 diff 스크롤, 새로고침, 비-저장소 폴더.

## 7. 변경 범위
- Rust: `src-tauri/src/git.rs`(신설), `src-tauri/src/lib.rs`(핸들러 등록). `fs_ops`의 텍스트/바이너리 판정 재사용(필요 시 pub).
- Frontend: `src/api/git.ts`(+`types.ts` 타입), `src/store/gitStore.ts`, `src/components/DiffView.tsx`, `src/components/ActivityBar.tsx`(아이콘+View 타입), `src/components/icons`(git 아이콘), `src/App.tsx`(activeView git 분기·메인영역), `src/store/workspaceStore.ts`(activeView 타입 확장).

## 8. Non-Goals (재확인)
사이드바 점프 목록 · 구문 강조 · split 보기 · 자동 갱신 · 브랜치-base diff · 스테이징/커밋/되돌리기.
