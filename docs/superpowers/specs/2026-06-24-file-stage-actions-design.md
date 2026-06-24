# 파일 단위 Stage / Unstage / Discard 설계 문서

- 작성일: 2026-06-24
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: staged/unstaged diff 구분 완료(`git_changes`가 `staged`/`unstaged` 두 스트림 반환, DiffView가 파일당 "Staged"/"Unstaged" 섹션 블록 렌더). 이 작업은 그 위에 **쓰기(mutation) 액션**을 얹는다.
- 범위: 이 문서는 2개 sub-project 중 **첫 번째(파일 단위)**. 헌크/라인 단위는 후속 sub-project 2에서 별도 spec.

## 1. 개요

diff 뷰의 섹션 행에서 파일 단위로 git 상태를 바꾼다:
- **Stage**: unstaged 변경을 인덱스에 올림 (`git add`)
- **Unstage**: staged 변경을 인덱스에서 내림 (`git restore --staged`, HEAD 없으면 `git rm --cached`)
- **Discard**: unstaged 변경을 버림 (tracked는 `git restore`, untracked는 파일 삭제) — 파괴적, 확인 필요

액션 성공 시 `git_changes`를 재로드해 diff·배지·카운트가 새 상태로 갱신된다. 단일 파일 단위만 다룬다.

### 1.1 범위
- 백엔드: 단일 파라미터화 명령 `git_file_action(root, path, action)` (action ∈ stage|unstage|discard).
- 프론트: "Staged" 섹션 행에 Unstage 버튼, "Unstaged" 섹션 행에 Stage·Discard 버튼(hover 노출). Discard는 confirm 후 실행.
- 액션 후 `gitStore.load(root)`로 단방향 갱신.

### 1.2 비범위 (후속/별개)
헌크·라인 단위 stage/unstage(sub-project 2) · 일괄 액션(Stage all 등) · 에디터 탭 자동 동기화(파일 watch) · 커밋 기능.

## 2. 백엔드 (`src-tauri/src/git.rs`, `lib.rs` 등록)

### 2.1 명령 `git_file_action`
```rust
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileAction {
    Stage,
    Unstage,
    Discard,
}

#[tauri::command]
pub async fn git_file_action(root: String, path: String, action: FileAction) -> Result<(), AppError>
```
`serde` 기본값은 enum 변형명 그대로(`"Stage"`)이므로, 프론트의 소문자 문자열 `"stage"|"unstage"|"discard"`와 매핑하려면 `rename_all="lowercase"`가 **필수**다. (이는 snake_case 필드 struct에 `rename_all`을 안 붙이는 관례와는 무관한, enum 문자열 매핑을 위한 별개 사항이다.) `spawn_blocking`으로 실행.

**`root`/`path` 출처**: 이 명령은 git 모듈의 `git_changes`/`git_worktrees`와 동일하게 `root: String` 인자를 받는다(`Workspace` state 미사용 — git 모듈 내 일관성). `path`는 `git_changes`가 반환한 **root-상대 경로**(diff가 보고한 그대로)를 프론트가 되돌려 보낸다. 기존 `untracked_file_diff`도 `root.join(rel)`로 root-상대 path를 다루므로 일관적이다.

### 2.2 동작 (순수 로직 `file_action(root, path, action) -> Result<(), AppError>`)
1. 비-저장소(`is_inside_repo` false) → `AppError`(Io/적절 코드) 반환.
2. 분기:
   - **Stage**: `git -C root add -- <path>`. (untracked·modified·deleted 모두 `add`가 처리.)
   - **Unstage**: HEAD 있으면(`has_head`) `git -C root restore --staged -- <path>`; HEAD 없으면 `git -C root rm --cached -- <path>`(최초 커밋 전 인덱스에서 내림).
   - **Discard**:
     - 추적 여부 판별: `git -C root ls-files --error-unmatch -- <path>` 성공 → tracked, 실패 → untracked.
     - tracked → `git -C root restore -- <path>`. **의미 못박기**: `git restore`의 기본 소스는 **인덱스**, 기본 대상은 워킹트리(`--worktree`). 즉 워킹트리를 **인덱스 내용으로 되돌린다**(HEAD가 아님). 따라서 staged 변경은 **보존**되고 **unstaged(워킹트리) 변경만** 버려진다. 이 의미가 "Unstaged 섹션의 Discard = 이 파일의 unstaged 변경만 취소"와 정확히 일치한다. (`git restore --source=HEAD`나 `git checkout --`로 바꾸면 staged까지 날아가므로 금지.)
     - untracked → 워킹트리 파일 삭제(§2.3 경로 검증 후 `std::fs::remove_file`).
3. git 명령 비-0 종료 → stderr를 담은 `AppError` 반환.

`--` 구분자로 경로를 옵션이 아닌 pathspec으로 못박는다(`-`로 시작하는 파일명 방어).

### 2.2.1 partial-staging(AM) discard 동작 (명시)
한 파일이 staged-add 후 워킹트리에서 더 수정되면 staged 스트림엔 `added`, unstaged 스트림엔 `modified`로 등장한다. 이 파일은 unstaged 섹션에 Discard 버튼을 가진다. Discard → `ls-files --error-unmatch` 성공(인덱스에 있음=tracked) → `git restore -- <path>` → 워킹트리가 인덱스(=staged-add 버전)로 되돌아간다. **결과: unstaged 수정만 제거되고 파일은 staged(`added`)로 그대로 남는다 — 파일이 삭제되지 않는다.** 이는 "unstaged 변경 취소"의 올바른 의미이며, no-op이 아니라 워킹트리 델타를 실제로 되돌린다. (반대로 staged-add만 있고 추가 수정이 없는 파일은 unstaged 섹션·Discard 버튼 자체가 없어 이 경로로 도달하지 않는다.) confirm 문구는 unstaged status가 `modified`이므로 untracked 분기가 아닌 일반 "Discard changes to <path>"를 쓴다 — 정확함.

### 2.3 경로 안전 (discard 파일 삭제) — 기존 가드 재사용
`remove_file` 대상은 root-상대 path를 절대경로로 만든 `Path::new(&root).join(&path)`. **새 검증을 만들지 않고 기존 `workspace::resolve_in_workspace(root: &Path, candidate: &str)`를 재사용**한다(lexical normalize + `starts_with(root)`, 위반 시 `ErrorCode::OutsideWorkspace` 반환 — 이미 단위 테스트됨). 구체적으로: `let abs = Path::new(&root).join(&path);` → `resolve_in_workspace(Path::new(&root), abs.to_str()…)?`로 검증된 경로를 얻어 `remove_file`. `path`에 `..`가 섞여도 normalize가 처리한다.
- git 명령(stage/unstage/tracked discard)은 `git -C root`가 경로를 저장소 기준으로 해석하므로 별도 fs 접근·검증 없음.

### 2.4 헬퍼 재사용
`git_output`, `is_inside_repo`, `has_head` 재사용. git 명령 실행 결과의 status 확인 + stderr 추출 패턴은 작은 헬퍼(`run_git(root, args) -> Result<(), AppError>`)로 묶어 stage/unstage/tracked-discard에서 공용.

## 3. 프론트엔드 API / 타입 / 스토어

### 3.1 API (`src/api/git.ts`, `types.ts`)
```ts
// types.ts
export type FileAction = "stage" | "unstage" | "discard";

// git.ts
export const gitFileAction = (root: string, path: string, action: FileAction) =>
  invoke<void>("git_file_action", { root, path, action });
```

### 3.2 갱신 흐름
- 액션은 `DiffView` 내부 핸들러에서 수행(root는 prop). 성공/실패 무관하게 `useGitStore.getState().load(root)`로 재로드(seq-guard로 동시성 안전) → DiffView·ActivityBar 배지·헤더 카운트가 store 구독으로 자동 갱신.
- **in-flight 가드**: 전역 단일 `useState<boolean>`(파일별 아님). 갱신이 전역 `load(root)` 한 번이고 액션이 빠르므로 단순한 전역 플래그로 충분. 진행 중 모든 섹션 버튼 `disabled`.
- 에디터 탭은 건드리지 않음(파일 watch는 비범위).

### 3.3 에러 표시 (확정)
앱에 공유 toast/notice 서비스가 없다(코드 확인: `App.tsx`의 `setNotice`는 App-로컬 state, `SearchPanel`도 자체 인라인). 따라서 **DiffView-로컬 state(`actionError: string | null`)에 액션 에러를 담아 인라인으로 표시**한다(헤더 근처 짧은 텍스트, 다음 액션 시작 시 클리어).
- **`gitStore.error`와 분리**: DiffView의 전체화면 `<Centered>{error}</Centered>` 분기는 **로드 실패 전용**으로 둔다. 액션 실패는 `actionError`(인라인)로만 표시해, diff 전체가 사라지지 않게 한다.
- 액션 실패해도 `load(root)`는 호출해 실제 git 상태를 반영한다(아래 §4.3). 단, `gitStore.load`가 시작 시 `error:null`로 리셋하므로 액션 에러를 `gitStore.error`에 넣으면 즉시 지워진다 — 그래서 `actionError`를 별도 보관한다.

## 4. UI — 섹션 행 액션 (`DiffView.tsx`)

### 4.1 `section` Row 확장
현재 `{ kind:"section"; label:"Staged"|"Unstaged" }` →
```ts
| { kind: "section"; label: "Staged" | "Unstaged"; path: string; isUntracked: boolean }
```
행 빌드 시 `path = mf.path`, `isUntracked = mf.unstaged?.status === "untracked"`(discard 문구 분기용; "Staged" 섹션에선 미사용).

### 4.2 버튼 배치 / 렌더
- **"Staged" 섹션**: `Unstage` 버튼 → `onAction(path, "unstage")`.
- **"Unstaged" 섹션**: `Stage` 버튼 → `onAction(path, "stage")`; `Discard` 버튼 → confirm 후 `onAction(path, "discard")`.
- 섹션 행 우측에 hover 시 노출(기존 expander 버튼 스타일·접근성 라벨 재사용). in-flight 중 `disabled`. (참고: 섹션 행 자체엔 클릭 핸들러가 없고 — collapse 토글은 별개의 `file` 행에 있음 — 버튼은 형제 행이라 `stopPropagation`은 불필요. 단 버튼이 미래에 클릭 가능한 컨테이너 안에 들어가면 재검토.)
- `renderRow`의 `section` 분기에 라벨 + 버튼 렌더. `onAction`을 `renderRow`에 `toggle`/`expand`와 함께 전달.

### 4.3 핸들러 `onAction(path, action)` (DiffView 내)
1. `action === "discard"`면 `confirm(...)`:
   - tracked: `Discard changes to <path>? This cannot be undone.`
   - untracked: `Delete untracked file <path>? This cannot be undone.`
   - 취소면 return.
2. `setActionError(null)` → in-flight=true → `try { await gitFileAction(root, path, action); } catch (e) { setActionError(message(e)); } finally { await load(root); in-flight=false }`. (액션 에러는 `actionError` 로컬 state, §3.3 — `gitStore.error`와 분리.)

(untracked 여부는 섹션 Row의 `isUntracked`로 confirm 문구를 고르되, 실제 tracked/untracked 분기 실행은 백엔드가 권위.)

## 5. 데이터 흐름
섹션 버튼 클릭 → (discard면 confirm) → `gitFileAction(root, path, action)` → 성공 시(혹은 실패 후에도) `gitStore.load(root)` → DiffView 새 staged/unstaged 재렌더, 배지·카운트 자동 갱신. 단방향. 에디터 탭 불변.

## 6. 에러 / 엣지
- git 명령 실패(권한·잠금): `AppError` → 메시지 표시, 그래도 `load(root)`.
- Discard untracked: `git restore`가 동작 안 하므로 파일 삭제 분기. 삭제 실패 시 에러.
- Unstage(HEAD 없음): `git restore --staged` 불가 → `git rm --cached`.
- 경로 탈출(`../`): discard 파일 삭제 전 root 하위 검증, 위반 시 거부.
- 동시 클릭: in-flight 가드(버튼 disabled).
- 액션 결과 섹션 소멸: unstaged 전부 stage → unstaged 섹션 사라지고 staged만; partial이 완전 staged로 수렴 등 — merge 재계산으로 자연 반영.
- 비-저장소: 명령이 에러 반환(실제로는 git 뷰가 비-저장소면 섹션·버튼이 없음).

## 7. 테스트
- **Rust(`git.rs`, hermetic temp repo, `core.excludesFile`/`core.hooksPath`=/dev/null)**:
  - stage: untracked 파일 stage → staged에 등장; modified 파일 stage → staged.
  - unstage: staged modified → unstage 후 unstaged로; HEAD 없는 repo의 staged 신규 파일 → `rm --cached`로 인덱스에서 내려 untracked로.
  - discard: tracked modified → `restore`로 워킹트리가 인덱스로 원복; untracked → 파일 삭제(존재 안 함).
  - **discard partial-staging(AM)** (§2.2.1): staged-add 후 워킹트리 수정한 파일 discard → 워킹트리가 인덱스(staged-add 버전)로 되돌아가고 파일은 staged(`added`)로 **남음**(삭제 안 됨). staged 스트림에 여전히 등장, unstaged 수정만 사라짐을 검증.
  - **discard가 staged 변경을 보존**: staged+unstaged 둘 다 있는 modified 파일 discard → 인덱스(staged) 버전으로 워킹트리 복원, staged 변경 유지 검증.
  - 경로 탈출(`../escape`) → `resolve_in_workspace`가 `OutsideWorkspace` 거부. 비-저장소 → 에러.
  - 순수 로직 `file_action`을 직접 호출해 검증(명령 래퍼는 얇게).
  - 참고: untracked 경로는 항상 **파일**(`ls-files --others`가 디렉터리가 아닌 개별 파일을 나열)이라 `remove_file`로 충분(디렉터리 케이스 없음).
- **프론트 단위**: `gitFileAction`이 `invoke("git_file_action", {root, path, action})`로 호출되는지.
- **DiffView 컴포넌트**: Staged 섹션에 Unstage 버튼·Unstaged 섹션에 Stage·Discard 버튼 렌더; 버튼 클릭 시 `gitFileAction` 호출(목킹)·이후 `load` 재호출; Discard는 `confirm` true일 때만 호출·false면 미호출(`window.confirm` 목킹); in-flight 중 `disabled`. 기존 DiffView 테스트 유지.
- **수동**: 실제 repo에서 stage/unstage/discard, untracked 삭제·partial staging 흐름 확인.

## 8. 변경 범위
- `src-tauri/src/git.rs`: `FileAction` enum, `file_action` 순수 로직 + `git_file_action` 명령, `run_git` 헬퍼, discard 삭제 경로는 `workspace::resolve_in_workspace` 재사용(신규 검증 안 만듦), 테스트.
- `src-tauri/src/lib.rs`: `git::git_file_action` 핸들러 등록.
- `src/api/types.ts`: `FileAction` 타입. `src/api/git.ts`: `gitFileAction`.
- `src/components/DiffView.tsx`: `section` Row 확장(path·isUntracked), 섹션 버튼 렌더, `onAction` 핸들러, 전역 in-flight 상태, `actionError` 로컬 state 인라인 표시(`gitStore.error`와 분리). `DiffView.test.tsx` 액션 테스트 추가.
- gitStore 본체 변경 없음(`load` 재사용).

## 9. Non-Goals (재확인)
헌크/라인 단위(sub-project 2) · 일괄 액션 · 에디터 탭 자동 동기화 · 커밋 · stage 후 push.
