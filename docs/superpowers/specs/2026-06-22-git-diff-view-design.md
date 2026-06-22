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
2. 브랜치명: `git -C root symbolic-ref --short HEAD` 사용(커밋 없는 unborn 저장소에서도 정상 동작하며 첫 커밋이 올라갈 브랜치명을 출력). detached HEAD면 비-0 종료 → `git rev-parse --short HEAD`로 폴백해 short SHA 표시. **이 단계의 비-0 종료를 명령 전체 실패로 취급하지 말 것**(브랜치명은 부가 정보).
3. `git -C root diff HEAD --no-color -M` → 추적 파일 변경(staged+unstaged vs HEAD, 리네임 추적). stdout을 §3.4 파서로 구조화. **단, 커밋이 하나도 없는 저장소(unborn HEAD)면 HEAD가 없어 실패하므로**, 먼저 `git -C root rev-parse --verify HEAD`로 HEAD 존재를 확인하고 없으면 이 단계를 건너뛴다(스테이징된 신규 파일은 `ls-files --cached`/`diff --cached`로도 잡을 수 있으나, v1에선 unborn HEAD에서 추적 diff를 생략하고 untracked만 표시 — 신규 저장소 흔치 않음).
4. `git -C root ls-files --others --exclude-standard -z` → untracked 경로 목록. 각 파일을 읽어(기존 `fs_ops`의 텍스트/바이너리/`MAX_TEXT_BYTES` 판정 재사용) **전부-추가(add) FileDiff**로 합성. 바이너리/초대용량은 `binary`/별도 플래그로 표시하고 hunks 비움.
5. 두 목록을 합쳐 `files`로 반환(추적 변경 먼저, untracked 뒤, 각 그룹은 경로 정렬).

### 3.3 데이터 형태 (serde → JSON, **snake_case**)
> 기존 코드베이스는 `#[serde(rename_all=...)]` 없이 Rust 필드명 그대로(snake_case) 직렬화한다(`fs_ops::DirEntry { is_dir }`, `LineMatch { line_number, match_start }` 등). 따라서 아래 필드는 snake_case로 직렬화되며, `src/api/types.ts`의 TS 타입도 `is_repo`/`old_path`/`old_no`/`new_no`/`too_large` 등 snake_case로 정의한다. (`rename_all="camelCase"`를 추가하지 말 것.)
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
- **무시할 헤더 줄**: `old mode …` / `new mode …`(chmod) / `index <sha>..<sha> …` / `similarity index …` / `copy from`·`copy to`. 파싱에 영향 없이 건너뛴다. **헌크가 하나도 없는 파일(모드만 변경 등)은 status "modified", additions/deletions=0**으로 두고 헤더-only 행으로 렌더.
- `Binary files … differ` → `binary=true`, hunks 없음.
- `--- a/<p>` / `+++ b/<p>`(또는 `/dev/null`) → 경로 보강.
- `@@ -oldStart[,oldCnt] +newStart[,newCnt] @@ [context]` → 새 Hunk, `old_no=oldStart`, `new_no=newStart` 카운터 시작. **count 생략 시(`@@ -1 +1 @@`) 기본값 1**.
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
- `ActivityBar`에 Source Control(git) 아이콘 추가.
  - **`isActive`를 뷰 타입 인지로 변경**: explorer/search는 기존대로 `sidebarVisible && activeView===v`, **git은 `activeView==="git"`(사이드바 무관)** 으로 하이라이트.
  - `App.activate("git")`은 `setActiveView("git")` + `setSidebarVisible(false)`(사이드바 패널이 diff 옆에 남지 않도록). 같은-뷰 토글로 사이드바를 접는 기존 분기는 git에 적용하지 않는다.
- **메인 영역 토글(언마운트 금지)**: TabBar/EditorPane/StatusBar 서브트리는 **항상 마운트 유지**하고 `activeView==="git"`일 때 `hidden` 클래스로 감춘다. `<DiffView>`는 그 위/옆에 함께 마운트해 `activeView==="git"`일 때만 보인다(사이드바 패널이 `flex`/`hidden`으로 공존하는 기존 패턴과 동일). **이렇게 해야 영속 EditorView(단일 인스턴스 + per-path EditorState 캐시)가 git 뷰 진입/이탈로 파괴되지 않는다.** (편집 화면을 조건부로 "교체"하면 EditorPane이 언마운트되어 undo/커서/스크롤 캐시가 사라지므로 금지.)
- 다른 뷰(explorer/search)나 파일/탭을 선택하면 `activeView`가 바뀌어 편집 화면이 다시 보인다.

### 4.3 상태/데이터
- `src/store/gitStore.ts`(Zustand): `{ changes: GitChanges | null, loading: bool, error: string | null, load(root): Promise<void> }`. `load`는 `gitChanges(root)` 호출 후 상태 갱신(레이스 방지 시퀀스 가드).
- `DiffView`는 git 뷰 진입 시(`activeView`가 git이 됨 + root 존재) `load(root)` 호출, 상단 새로고침 버튼으로도 호출.

### 4.4 컴포넌트
- **`DiffView`**(메인): 상단바(브랜치명 · 변경 파일 수 · 새로고침 버튼) + 본문. 상태별 렌더: loading / error / `is_repo===false`("Not a Git repository") / 변경 없음("No changes") / 파일 목록.
- 본문은 파일/헌크/줄을 **단일 행 리스트로 평탄화**해 `@tanstack/react-virtual`로 가상화(`SearchPanel`과 동일 패턴; 거대 diff 대비). **스크롤 컨테이너에 `zk-scroll` 클래스 부여 필수**(테스트의 offsetHeight 스텁이 이 클래스로 동작). `estimateSize`는 행 종류별 고정 높이를 반환(`(i) => ROW_H[rows[i].kind]`). 행 종류:
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
- **알려진 v1 한계 — 스테이징 후 작업트리에서 삭제한 파일**: 인덱스엔 추가됐지만 워킹트리엔 없는 경우 `git diff HEAD`(net-zero)와 `ls-files --others`(인덱스에 있음) 둘 다에서 누락되어 표시되지 않는다. 드문 케이스로 v1에선 미표시(후속에서 `diff --cached` + `diff` 합집합으로 보완 가능).
- 모드만 변경(chmod): 헌크 없는 "modified" 헤더로 표시(§3.4).

## 6. 테스트
- **Rust 단위(핵심)**: `parse_diff`를 대표 `git diff` 출력으로 검증 — 단순 수정(다중 헌크), 신규 파일, 삭제 파일, 리네임(내용 변경 유/무), 바이너리, `\ No newline at end of file`, **모드만 변경(`old mode`/`new mode`, 헌크 없음)**, **count 생략 헌크(`@@ -1 +1 @@`)**, `index` 줄 스킵, 라인번호 카운팅/additions·deletions 집계.
- **프론트**: 목 `GitChanges`로 `DiffView` 렌더 — loading/error/비-저장소/변경없음/파일들; 파일 접기 토글; add/del/context 줄 스타일·라인번호; 바이너리/too-large 안내. 가상화는 기존 jsdom 스텁(ResizeObserver·`.zk-scroll` offsetHeight) 재사용.
- **수동**: 실제 저장소에서 `tauri dev` — 수정/추가/삭제/리네임/untracked/바이너리, 거대 diff 스크롤, 새로고침, 비-저장소 폴더.

## 7. 변경 범위
- Rust: `src-tauri/src/git.rs`(신설), `src-tauri/src/lib.rs`(핸들러 등록). untracked 파일의 텍스트/바이너리/`MAX_TEXT_BYTES` 판정은 `fs_ops`의 **판정 로직을 작은 `pub` 헬퍼로 추출해 재사용**(`read_file_impl`은 워크스페이스 해석 + `FileContent` 반환이라 그대로 호출하지 말고, 바이트→Text/Binary/TooLarge 판정 부분만 공유).
- Frontend: `src/api/git.ts`(+`types.ts` 타입), `src/store/gitStore.ts`, `src/components/DiffView.tsx`, `src/components/ActivityBar.tsx`(아이콘+View 타입), `src/components/icons`(git 아이콘), `src/App.tsx`(activeView git 분기·메인영역), `src/store/workspaceStore.ts`(activeView 타입 확장).

## 8. Non-Goals (재확인)
사이드바 점프 목록 · 구문 강조 · split 보기 · 자동 갱신 · 브랜치-base diff · 스테이징/커밋/되돌리기.
