# 워크트리 전환 UI 설계 문서

- 작성일: 2026-06-23
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: 모든 기능(검색·explorer·git diff)이 단일 워크스페이스 루트에 종속됨이 확인됨. 전환 = 루트를 다른 워크트리 경로로 바꾸고 리로드.

## 1. 개요

타이틀바 드롭다운으로 현재 저장소의 git 워크트리 목록을 보고 선택해 **워크스페이스 루트를 그 워크트리로 전환**한다. 전환 시 열린 파일은 같은 상대경로로 새 워크트리에서 다시 연다.

### 1.1 범위
- 워크트리 **목록 + 전환**만. 타이틀바 드롭다운(현재 프로젝트명·브랜치 표시 + 목록).
- 전환 시: 루트 변경 → explorer/검색/git diff가 새 워크트리 기준으로 동작 → 열린 탭을 상대경로로 리맵.

### 1.2 비범위
워크트리 생성/삭제 · 브랜치 체크아웃/전환 · 파일시스템 자동 watch.

## 2. 백엔드 (`src-tauri/src/git.rs`, `lib.rs` 등록)

### 2.1 명령 `git_worktrees`
```
#[tauri::command]
async fn git_worktrees(root: String) -> Result<Vec<Worktree>, AppError>
```
```
#[derive(Serialize)] struct Worktree {
  path: String,            // git이 보고하는 워크트리 절대경로
  branch: Option<String>,  // "refs/heads/<name>" → <name>; detached면 None
  is_current: bool,        // 현재 열린 워크트리인지
}
```
절차(`spawn_blocking`):
1. 비-저장소(`rev-parse --is-inside-work-tree` 실패) → 빈 `Vec`.
2. `git -C root rev-parse --show-toplevel` → 현재 워크트리 top 경로(`current`). (root와 git 경로 표기 차이를 피하려고 git이 보고하는 값으로 비교.)
3. `git -C root worktree list --porcelain` → §2.2 파서로 `Vec<Worktree>`; `is_current = (path == current)`.

### 2.2 순수 파서 `parse_worktrees(stdout, current) -> Vec<Worktree>`
`--porcelain`은 빈 줄로 구분된 블록. 각 블록:
- `worktree <path>` → path.
- `branch refs/heads/<name>` → `branch = Some(name)`; `detached` 줄 → `branch = None`; (HEAD/bare 등 기타 줄 무시).
- `is_current = (path == current)`.
빈 줄 기준으로 블록 분리, 순서 보존.

## 3. 프론트엔드

### 3.1 API / 타입
- `src/api/git.ts`: `gitWorktrees(root): Promise<Worktree[]>` (invoke "git_worktrees").
- `src/api/types.ts`: `interface Worktree { path: string; branch: string | null; is_current: boolean }` (snake_case).

### 3.2 타이틀바 드롭다운 (`TitleBar.tsx`)
- props 변경: `{ root: string | null; branch: string | null; onSwitchWorktree: (path: string) => void }`. 표시 라벨 = `basename(root)` + 브랜치 있으면 ` (branch)`. root 없으면 기존처럼 `zk-code-editor`.
- 라벨을 **클릭 가능한 버튼**으로(드래그 영역 내 `pointer-events` 처리). 클릭 → 드롭다운 토글. 열릴 때 `gitWorktrees(root)` 호출(로컬 state). 목록: 각 항목 `브랜치(또는 SHA표기 없으면 경로 basename) · 경로`, 현재(`is_current`)는 ✓ 강조. 항목 클릭 → `is_current`가 아니면 `onSwitchWorktree(path)` 후 닫힘.
- 워크트리가 0~1개면 드롭다운은 현재 항목만(또는 비활성). 브랜치 라벨은 `gitStore.changes?.branch` 재사용(이미 로드됨)이며, root 없거나 비-저장소면 브랜치 생략.

### 3.3 전환 오케스트레이션 (`App.tsx`)
`onSwitchWorktree`(= `switchWorktree(path)`):
1. `path === root` → 무시.
2. **dirty 가드**: `tabs.some(t => t.dirty)`면 `confirm("Unsaved changes will be lost. Switch worktree?")`; 취소면 중단.
3. **전환 전** 값 캡처: `const oldRoot = root`; `openRel = tabs.map(t => relativePath(oldRoot, t.path))`, `activeRel = activeTabPath ? relativePath(oldRoot, activeTabPath) : null`.
4. 루트 전환: `await setWorkspaceRoot(path)`(백엔드) → `setRoot(path)`(store) → `saveWorkspaceRoot(path)`(영속).
5. 기존 탭 정리: `closeTabsUnder(oldRoot)`(이전 루트 하위 탭 전부 닫힘 — path가 oldRoot 기준이라 정리됨).
6. 리맵 재오픈: 각 `rel`에 대해 `await openFile(joinPath(path, rel))`(읽기 성공·텍스트만 열림; 없거나 바이너리/대용량은 `openFile`이 알아서 스킵). 모두 연 뒤 `activeRel`의 새 경로가 열려 있으면 `setActive(joinPath(path, activeRel))`.
7. `useGitStore.getState().load(path)`로 배지·diff 갱신.
- 이 핸들러는 직렬(순차 await)로 수행하며, 동시 전환 방지를 위해 간단한 in-flight 가드(ref) 사용.

### 3.4 FileExplorer 루트 반영 (`FileExplorer.tsx`)
현재는 마운트 시에만 트리를 읽는다. **`[root]` 변경 시 `readDir(root)`로 트리를 재나열**하는 효과를 추가해, 워크트리 전환(및 Open Folder)이 즉시 반영되게 한다. 기존 마운트 복원 효과(Vite 리로드 대비 루트 복원)는 유지하되, 나열은 `[root]` 효과가 담당(중복 방지).

## 4. 데이터 흐름
타이틀바 드롭다운 열기 → `gitWorktrees(root)` → 목록. 선택 → `App.switchWorktree` → 루트 전환 + 탭 리맵 + git 재로드. FileExplorer는 `[root]`로 재나열, SearchPanel은 다음 검색부터 새 루트, gitStore는 재로드. 단방향.

## 5. 에러 / 엣지
- 비-저장소: `git_worktrees` 빈 배열 → 드롭다운에 전환 항목 없음(프로젝트명만). 타이틀 브랜치 생략.
- 워크트리 1개: 현재만 표시(전환 대상 없음).
- detached HEAD: `branch=null` → 항목 라벨은 경로 basename(또는 "(detached)").
- 리맵 대상 파일이 새 워크트리에 없음/바이너리/대용량 → `openFile`이 스킵(드롭).
- dirty 탭: 전환 전 확인.
- 전환 중 오류(setWorkspaceRoot 실패 등) → notice 표시, 루트 변경 롤백은 하지 않음(사용자가 다시 선택). git 명령 실패 → 빈 목록.
- `is_current` 판별은 `--show-toplevel` 기준이라 root 표기 차이(symlink 등)에 견고.

## 6. 테스트
- **Rust 단위(`parse_worktrees`)**: 다중 워크트리(메인+링크드), `branch refs/heads/x` → "x", `detached` → None, `is_current` 매칭, 블록 순서 보존.
- **Rust 통합(선택)**: 임시 저장소 + `git worktree add`로 `git_worktrees`가 2개 반환·is_current 정확(hermetic config).
- **프론트 단위**: 탭 리맵(상대경로 변환) 헬퍼가 있으면 단위 테스트(또는 switchWorktree 로직의 경로 계산). TitleBar: 드롭다운이 워크트리 목록 렌더, 현재 ✓, 다른 항목 클릭 시 `onSwitchWorktree(path)` 호출(gitWorktrees 목킹).
- **수동**: 실제 `git worktree add`로 만든 워크트리 간 전환 → explorer/검색/git diff/열린 파일이 새 워크트리 기준으로 바뀌는지, dirty 확인.

## 7. 변경 범위
- `src-tauri/src/git.rs`(+`git_worktrees`/`parse_worktrees`), `src-tauri/src/lib.rs`(핸들러 등록).
- `src/api/git.ts`(+`gitWorktrees`), `src/api/types.ts`(+`Worktree`).
- `src/components/TitleBar.tsx`(드롭다운), `src/App.tsx`(`switchWorktree` + TitleBar 배선), `src/components/FileExplorer.tsx`(`[root]` 재나열).
- workspaceStore 변경 불필요(`closeTabsUnder`/`setRoot`/`setActive` 재사용).

## 8. Non-Goals (재확인)
워크트리 생성/삭제 · 브랜치 전환 · 자동 watch · 워크트리별 탭 세션 영속.
