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

`current`가 비면(예: `--show-toplevel` 실패) 어떤 항목도 `is_current=true`가 되지 않음(무해 — ✓ 없음, 전부 전환 가능).

### 2.2 순수 파서 `parse_worktrees(stdout, current) -> Vec<Worktree>`
`--porcelain`은 빈 줄로 구분된 블록. 각 블록을 **알려진 접두사만 매칭하고 나머지 줄은 무시**한다(고정 N줄 가정 금지):
- `worktree <path>` → path.
- `branch refs/heads/<name>` → `branch = Some(name)`.
- `detached` → `branch = None`.
- 그 외(`HEAD <sha>`, `bare`, `locked`, `prunable` 등) → 무시. `bare`/`detached` 블록은 branch 없이 path만.
- `is_current = (path == current)`.
빈 줄 기준으로 블록 분리, 순서 보존.

## 3. 프론트엔드

### 3.1 API / 타입
- `src/api/git.ts`: `gitWorktrees(root): Promise<Worktree[]>` (invoke "git_worktrees").
- `src/api/types.ts`: `interface Worktree { path: string; branch: string | null; is_current: boolean }` (snake_case).

### 3.2 타이틀바 드롭다운 (`TitleBar.tsx`)
- props 변경: `{ root: string | null; branch: string | null; onSwitchWorktree: (path: string) => void }`. 표시 라벨 = `basename(root)` + 브랜치 있으면 ` (branch)`. root 없으면 기존처럼 `zk-code-editor`.
- **드래그 영역 처리(중요)**: 현재 TitleBar는 `data-tauri-drag-region`으로 감싸고 중앙 라벨은 `pointer-events-none`. 클릭 가능한 트리거 버튼과 드롭다운 팝오버는 (a) `data-tauri-drag-region`이 **아니어야** 하고 (b) `pointer-events-auto`여야 한다. 그렇지 않으면 mousedown이 윈도우 드래그로 먹혀 첫 클릭이 무시된다. 버튼/팝오버 모두에 적용하고 macOS에서 클릭 동작을 수동 확인.
- 라벨을 트리거 버튼으로. 클릭 → 드롭다운 토글. **열릴 때마다** `gitWorktrees(root)` 호출(로컬 state, 매번 새로 fetch → 전환 후/외부 추가 반영). 목록: 각 항목 `브랜치(detached면 경로 basename 또는 "(detached)") · 경로`, 현재(`is_current`)는 ✓ 강조.
- 항목 클릭: **`is_current`면 no-op**(닫기만), 아니면 `onSwitchWorktree(path)` 후 닫힘. (현재 판별은 store `root` 문자열 비교가 아니라 git이 보고한 `is_current` 플래그로 — §5 정규화 이슈 회피.)
- **lifecycle**: 바깥 클릭 / Escape 시 닫힘(문서 레벨 리스너 또는 오버레이). 워크트리 0~1개면 전환 대상 없음(현재 항목만 표시).
- 브랜치 라벨은 `gitStore.changes?.branch` 재사용(이미 로드됨); 전환 중 잠깐 이전 브랜치가 보일 수 있음(무해). root 없거나 비-저장소면 브랜치 생략.

### 3.3 전환 오케스트레이션 (`App.tsx`)
`onSwitchWorktree`(= `switchWorktree(path)`):
1. `!root` 또는 `path === root` → 무시(주된 no-op은 §3.2의 `is_current`로 이미 차단; 여기선 방어).
2. **dirty 가드**: `tabs.some(t => t.dirty)`면 `confirm("Unsaved changes will be lost. Switch worktree?")`; 취소면 중단.
3. **전환 전** 값 캡처: `const oldRoot = root`; `openRel = tabs.map(t => relativePath(oldRoot, t.path))`, `activeRel = activeTabPath ? relativePath(oldRoot, activeTabPath) : null`.
4. 루트 전환: `await setWorkspaceRoot(path)`(백엔드) → `setRoot(path)`(store) → `saveWorkspaceRoot(path)`(영속). `path`는 git이 보고한 정규화 경로이므로 전환 후 store `root`/탭/탐색기 경로가 모두 정규화 형태로 수렴(§5).
5. 기존 탭 정리: `closeTabsUnder(oldRoot)`(이전 루트 하위 탭 전부 닫힘 — 탭 path가 oldRoot 기준이라 정리됨).
6. 리맵 재오픈: 각 `rel`에 대해 `await openFile(joinPath(path, rel))`(읽기 성공·텍스트만 열림; 없거나 바이너리/대용량은 `openFile`이 알아서 스킵). 모두 연 뒤 `activeRel`의 새 경로가 열려 있으면 `setActive(joinPath(path, activeRel))`.
- git 재로드는 App의 기존 `[root]` 효과(`useGitStore.getState().load(root)`)가 `setRoot`로 자동 트리거하므로 별도 호출 불필요(중복 호출해도 gitStore seq-guard로 무해).
- 이 핸들러는 직렬(순차 await)로 수행하며, 동시 전환 방지를 위해 간단한 in-flight 가드(ref) 사용.

### 3.4 FileExplorer 루트 반영 (`FileExplorer.tsx`)
현재는 마운트 시에만 트리를 읽는다(복원 + 나열을 한 효과에서). 다음으로 분리:
- **복원 효과(유지)**: localStorage 루트 복원만 담당 — `await setWorkspaceRoot(target)` 후 `setRoot(target)`. **나열은 하지 않음**. (백엔드 `Workspace`가 리로드 후 `None`이므로 `setWorkspaceRoot`가 `setRoot`보다 먼저 끝나야 함 — 순서 보장.)
- **나열 효과(신설)**: `useEffect(() => { if (!root) return; readDir(root)…setEntries }, [root])`. **반드시 `!root` 가드** (초기 null에서 `readDir(null)` 방지). 복원 효과의 `setRoot`가 끝나면(=`setWorkspaceRoot` 완료 후) 이 효과가 나열 → 백엔드 루트가 이미 세팅돼 있어 안전. 워크트리 전환(§3.3의 `setRoot`)·Open Folder도 동일 경로로 즉시 재나열.

이로써 마운트 시 단일 나열, 복원/전환 모두 `[root]` 효과가 일관 처리.

## 4. 데이터 흐름
타이틀바 드롭다운 열기 → `gitWorktrees(root)` → 목록. 선택 → `App.switchWorktree` → 루트 전환 + 탭 리맵 + git 재로드. FileExplorer는 `[root]`로 재나열, SearchPanel은 다음 검색부터 새 루트, gitStore는 재로드. 단방향.

## 5. 에러 / 엣지
- 비-저장소: `git_worktrees` 빈 배열 → 드롭다운에 전환 항목 없음(프로젝트명만). 타이틀 브랜치 생략.
- 워크트리 1개: 현재만 표시(전환 대상 없음).
- detached HEAD: `branch=null` → 항목 라벨은 경로 basename(또는 "(detached)").
- 리맵 대상 파일이 새 워크트리에 없음/바이너리/대용량 → `openFile`이 스킵(드롭).
- dirty 탭: 전환 전 확인.
- 전환 중 오류(setWorkspaceRoot 실패 등) → notice 표시, 루트 변경 롤백은 하지 않음(사용자가 다시 선택). git 명령 실패 → 빈 목록.
- **경로 정규화(중요)**: store `root`는 폴더 피커/localStorage가 준 비정규화 경로일 수 있고(macOS `/tmp`↔`/private/tmp`, symlink), git(`worktree list`·`--show-toplevel`)은 정규화 경로를 반환한다. 따라서:
  - `is_current` 비교는 git이 보고한 두 값(porcelain path vs `--show-toplevel`) 사이라 **정규화 일치**(견고).
  - 그러나 "현재 워크트리"를 store `root`와 문자열 비교하면 어긋날 수 있으므로, 드롭다운 현재행 판별·no-op은 **git의 `is_current` 플래그**로 한다(§3.2). store `root` vs git path 직접 비교는 하지 않음.
  - 전환을 실행하면 `setRoot(path)`로 root가 git 정규화 경로가 되어 이후 탭/탐색기/검색 경로가 모두 정규화로 수렴.

## 6. 테스트
- **Rust 단위(`parse_worktrees`)**: 다중 워크트리(메인+링크드), `branch refs/heads/x` → "x", `detached` → None, `bare`/`locked`/`prunable`·`HEAD <sha>` 줄 무시(미지 줄에 견고), `is_current` 매칭, `current=""`면 전부 false, 블록 순서 보존.
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
