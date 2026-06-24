# Staged / Unstaged 변경사항 구분 설계 문서

- 작성일: 2026-06-24
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: Git Diff 뷰 + 파일 네비게이터 + 구문 강조 + 컨텍스트 확장 완료. 현재 `git diff HEAD` 한 번으로 staged·unstaged를 합쳐 보여줌(구분 없음).

## 1. 개요

현재 diff 뷰는 `git diff HEAD`로 working-tree 전체 변경을 구분 없이 표시한다. 이를 **staged**(index에 올라간 변경)와 **unstaged**(아직 안 올라간 변경)로 분리한다. 백엔드가 두 diff를 각각 계산해 `staged`/`unstaged` 두 배열로 반환하고, 프론트엔드는 path 기준으로 머지해 단일 파일 목록을 구성한다. partial staging(한 파일에 staged 헌크 + unstaged 헌크)인 파일은 diff 영역에 "Staged"·"Unstaged" 두 블록을 세로로 나열한다.

### 1.1 범위
- 백엔드: `git diff --cached`(staged) + `git diff`(unstaged) 분리 실행, `GitChanges`에 `staged`/`unstaged` 두 필드.
- 프론트: 파일 목록은 path 머지(단일 리스트, S/U/S+U 배지), diff 영역은 파일당 "Staged"/"Unstaged" 섹션 블록.
- 문법 강조: staged/unstaged 각각 올바른 `old_text`/`new_text` 출처로 채워 기존 강조 엔진 재사용.

### 1.2 비범위 (후속 작업)
- diff 뷰에서 직접 stage/unstage 액션(버튼) — 이번엔 **읽기 전용**.
- staged/unstaged 탭 전환 UI · 헌크 단위 stage.

## 2. 백엔드 (`src-tauri/src/git.rs`)

### 2.1 `GitChanges` 구조체 변경
```rust
pub struct GitChanges {
  pub is_repo: bool,
  pub branch: Option<String>,
  pub staged: Vec<FileDiff>,    // 기존 files 대체
  pub unstaged: Vec<FileDiff>,
}
```
`FileDiff`·`Hunk`·`DiffLine` 구조는 변경 없음.

### 2.2 `compute_changes` 변경
현재 `git diff HEAD --no-color -M` 1회 실행을 두 번으로 분리:
- `git -C root diff --cached --no-color -M` → `parse_diff` → `staged`.
- `git -C root diff --no-color -M` → `parse_diff` → `unstaged`.
- `git -C root ls-files --others --exclude-standard -z` (untracked) → `untracked_file_diff`로 합성해 `unstaged`에 append(기존 로직 유지, append 대상이 `unstaged`로 바뀜).

HEAD 없는 신규 repo: 기존 `has_head()` 가드 유지. HEAD 없으면 `git diff --cached`가 의미 없으므로 `staged`는 빈 배열, untracked만 `unstaged`에 들어간다. (`has_head()`가 false면 `--cached` 호출 자체를 건너뛰고 `staged = Vec::new()`.)

### 2.3 파일 전체 내용(`new_text`/`old_text`) 출처
문법 강조용으로 각 FileDiff에 전체 내용을 첨부한다. staged/unstaged별 출처가 다르다:

| 구분 | `old_text` | `new_text` |
|---|---|---|
| staged | HEAD (`git show HEAD:<path>`) | index (`git show :<path>`) |
| unstaged | index (`git show :<path>`) | 파일시스템(현재 파일) |
| untracked | `null` | 파일시스템(현재 파일) |

- `git show :<path>` (콜론 접두 = index 버전)가 새로 추가된다.
- 삭제 파일: staged 삭제면 `new_text=null`(index에 없음), `old_text`=HEAD. unstaged 삭제면 `new_text=null`(파일시스템에 없음), `old_text`=index.
- rename: 기존 `old_path` 처리 유지. `old_text`는 위 표의 출처에서 `old_path`(staged) / 해당 경로로 조회.
- 조회 실패(`git show` 비-0 종료 등)는 해당 텍스트를 `null`로 두고 plain 폴백(기존 강조 가드 재사용). status가 아니라 텍스트 존재 여부로 게이트.

### 2.4 헬퍼
- 기존 `git_output`, `parse_diff`, `untracked_file_diff`, `current_branch`, `has_head`, `is_inside_repo` 재사용.
- 파일 내용 첨부 로직을 staged/unstaged 각각에 적용한다. **§2.3 표가 유일한 권위**이며, 현재의 "modified/added는 파일시스템" 규칙을 그대로 옮기지 않는다. 구체적으로:
  - **staged 스트림**: `new_text` = **index**(`git show :<path>`), **파일시스템이 아님**. `old_text` = HEAD(`git show HEAD:<old_path 또는 path>`). working tree가 index와 다른 partial-staging에서 staged 블록을 파일시스템 내용으로 강조하면 틀린다 — 반드시 index에서 읽는다.
  - **unstaged 스트림**: `new_text` = 파일시스템(현재 파일), `old_text` = index(`git show :<path>`).
  - **rename의 index 조회 경로**: staged `new_text`(index)는 rename-to인 **`f.path`**로 조회한다(`f.old_path` 아님 — index에는 새 경로만 존재). staged `old_text`(HEAD)만 `f.old_path`(있으면)로 조회.
  - 텍스트 출처 분기는 "diff 종류(staged/unstaged) + status"로 결정하되 위 규칙을 따른다.

## 3. 데이터 모델 (TypeScript)

`src/api/types.ts`:
```ts
export interface GitChanges {
  is_repo: boolean;
  branch: string | null;
  staged: FileDiff[];    // 기존 files → 분리
  unstaged: FileDiff[];
}
```
`FileDiff`·`Hunk`·`DiffLine` 변경 없음. `gitStore.ts`는 `changes: GitChanges | null` 그대로 유지(구조만 바뀜).

### 3.1 다른 소비자 (`changes.files` 참조처)
`GitChanges.files` 제거로 깨지는 모든 소비자를 함께 고친다(grep `changes.*files` 확인 결과):
- **`src/components/ActivityBar.tsx:15`**: 소스컨트롤 배지 카운트 `s.changes?.files.length`. → **머지된 파일 수**로 변경(중복 path 1개): `const files = s.changes; files ? new Set([...files.staged, ...files.unstaged].map(f => f.path)).size : 0`. `staged.length + unstaged.length`는 partial-staging을 중복 카운트하므로 금지.
- `src/components/DiffView.tsx`: §4에서 전면 개편.
- `SearchPanel.tsx`의 `response.files`는 **검색 결과**(별개 타입)로 무관 — 건드리지 않음.

## 4. 프론트엔드 (`DiffView.tsx`)

### 4.1 파일 머지 헬퍼 (`src/lib/mergeFiles.ts`, 신설)
`staged`/`unstaged` 두 배열을 path 기준으로 머지해 단일 목록을 만든다:
```ts
import type { FileDiff } from "../api/types";

export interface MergedFile {
  path: string;
  staged: FileDiff | null;
  unstaged: FileDiff | null;
  status: FileDiff["status"]; // staged 우선, 없으면 unstaged
}

export function mergeFiles(staged: FileDiff[], unstaged: FileDiff[]): MergedFile[];
```
- 순서: staged 배열 순서를 먼저 보존하고, staged에 없는 unstaged 파일을 뒤에 append. (rename으로 path가 다를 수 있으나 머지 키는 `path`. old_path 기준 매칭은 비범위.)
- `status`: staged가 있으면 staged.status, 없으면 unstaged.status.
- 배지 분류: `staged && unstaged` → S+U, `staged`만 → S, `unstaged`만 → U.

### 4.2 파일 목록 (왼쪽 패널, `DiffFileList`)
- `MergedFile[]`을 받아 렌더. 각 행: 상태 badge(M/A/D/R/U) + path + 변경량.
- staged/unstaged badge 추가: staged만 `S`(초록 tint), unstaged만 `U`(노란 tint), 둘 다 `S`+`U` 병렬. 기존 +additions/−deletions는 staged·unstaged 합산 또는 각 표기(단순화를 위해: 둘 다 있으면 합산 표기).
- 활성 하이라이트·클릭 점프는 기존대로 path 단위.

### 4.3 diff 영역 (오른쪽) — Row 구조 변경
새 Row 종류 추가:
```ts
| { kind: "section"; label: "Staged" | "Unstaged" }
```
`ROW_H.section = 24`.

MergedFile 하나당 렌더 순서:
1. `file` 행(파일 헤더 + 토글 — 기존 그대로, path 단위).
2. `merged.staged`가 있으면: `section("Staged")` 행 + 기존 헌크/컨텍스트확장/expander 렌더(staged FileDiff 기준).
3. `merged.unstaged`가 있으면: `section("Unstaged")` 행 + 헌크/컨텍스트확장 렌더(unstaged FileDiff 기준).

- **path-keyed 맵 정리**: `collapsed`(접기)는 path 단위 — 접으면 staged·unstaged 블록 둘 다 숨김. `pathToRowIndex`·`fileOffsets`도 path(MergedFile) 단위. path는 머지 키라 MergedFile 간 유일 → 충돌 없음(의도된 설계).
- 컨텍스트 확장 gapKey만은 path로 부족하다: staged·unstaged가 같은 path라 `${file.path}#${idx}`가 충돌한다. **gapKey에 섹션 구분 추가**: `${path}#${section}#${idx}` (section = "s" | "u"). `expanded` Map·`expand` 핸들러·`fileGaps` 호출이 섹션별로 독립. (`expanded`는 `changes` 리로드 시 초기화되므로 stale 키 우려 없음 — 기존 로직.)
- 각 섹션의 헌크 렌더는 해당 FileDiff의 `new_text`/`old_text`로 강조(§2.3 출처). staged·unstaged의 `new_text`가 다르므로(index vs 파일시스템) 강조도 각 섹션의 출처로 독립 계산.
- **binary/too_large 처리**: 한 섹션의 FileDiff가 binary·too_large면 헌크 대신 `info` 행("Binary file not shown" / "File too large to display")을 그 **섹션 블록 내부**에 렌더. 한쪽만 binary일 수 있다(예: staged는 binary, unstaged는 텍스트).

### 4.4 offset/index 추적
- `pathToRowIndex`·`fileOffsets`는 **MergedFile 단위(path 기준)**로 추적(기존 FileDiff 단위에서 변경). 파일 목록 클릭 점프·활성 하이라이트(`activeFileForOffset`)는 MergedFile 단위 offset 사용.
- `top` 누적: section 행 높이(24), staged/unstaged 양쪽 헌크·expander·공개 줄, 그리고 binary/too_large `info` 행(28) 높이를 모두 반영해야 `activeFileForOffset`가 어긋나지 않는다.

### 4.5 헤더/빈 상태
- 헤더의 "N changed": `staged.length + unstaged.length`가 아니라 **머지된 파일 수**(MergedFile 개수)로 표기(중복 path 1개로 카운트). ActivityBar 배지(§3.1)와 동일한 카운트 규칙.
- 빈 상태: `staged.length === 0 && unstaged.length === 0` → "No changes".

## 5. 데이터 흐름
DiffView 활성/ root 변경 → `gitStore.load(root)` → `git_changes` → `{staged, unstaged}` → DiffView가 `mergeFiles`로 단일 목록 구성 → 파일 목록(배지)·diff 영역(섹션 블록) 렌더. 단방향. Refresh 버튼·워크트리 전환 모두 동일 경로 재로드.

## 6. 에러 / 엣지
- HEAD 없는 신규 repo: `staged` 빈 배열, untracked만 `unstaged`.
- partial staging: 같은 path가 `staged`·`unstaged` 양쪽 → MergedFile에서 두 섹션 블록 모두 표시.
- staged 신규 파일(`git add newfile`): `staged`에 status=added. 이후 재수정 시 `unstaged`에도 modified로 등장(양쪽).
- `git show :<path>` 실패: 해당 텍스트 `null` → plain 폴백.
- 삭제 파일: §2.3대로 `new_text` 또는 `old_text`가 `null`.
- 변경 없음: 양쪽 빈 배열 → "No changes".
- 워크트리 전환: gitStore 재로드, 구조 동일.

## 7. 테스트
- **Rust 단위/통합(`git.rs`)**: partial staging(한 파일 일부 `git add` → staged·unstaged 양쪽에 해당 파일); staged 신규 파일(`git add newfile` → staged=added, unstaged 비어있음); staged 후 추가 수정(양쪽 등장, 각 diff 내용 정확); HEAD 없는 repo(staged 빈 배열, untracked는 unstaged); `old_text`/`new_text` 출처 검증(staged의 old_text=HEAD, new_text=index). hermetic git config.
- **프론트 순수(`mergeFiles.test.ts`)**: path 머지, staged-only/unstaged-only/both 분류, status 우선순위(staged 우선), 순서 보존(staged 먼저, unstaged-only 뒤).
- **프론트 컴포넌트(`DiffView.test.tsx`)**: partial staging diff → "Staged"·"Unstaged" 섹션 행 둘 다 렌더; staged-only 파일 → "Staged" 섹션만; 파일 목록 S/U/S+U 배지 정확; gapKey 섹션 구분으로 staged/unstaged 컨텍스트 확장 독립. 기존 테스트는 `files` → `staged`/`unstaged` 구조로 업데이트(가상화 stub 재사용).
- **fixture 마이그레이션(테스트 깨짐 방지)**: `GitChanges` 구조 변경으로 깨지는 fixture를 모두 `files` → `staged`/`unstaged`로 갱신: `src/store/gitStore.test.ts`, `src/components/ActivityBar.test.tsx`(배지 카운트 검증 포함 — 머지 카운트로). 그 외 grep으로 `files:` 잔존 fixture 확인.
- **수동**: 실제 repo에서 `git add -p`로 partial staging → 양쪽 섹션·배지·문법 강조 확인.

## 8. 변경 범위
- `src-tauri/src/git.rs`: `GitChanges` 구조체(staged/unstaged), `compute_changes`(2회 diff + §2.3/§2.4 텍스트 출처 분기), 테스트 추가.
- `src/api/types.ts`: `GitChanges`(staged/unstaged).
- `src/lib/mergeFiles.ts`(신설) + `src/lib/mergeFiles.test.ts`.
- `src/components/DiffView.tsx`: section Row·ROW_H·머지 렌더·gapKey 섹션 구분·offset MergedFile 단위·배지·섹션 내 binary info 행, `DiffView.test.tsx` 업데이트.
- `src/components/ActivityBar.tsx`: 배지 카운트를 머지 파일 수로(§3.1), `ActivityBar.test.tsx` fixture·검증 업데이트.
- `src/store/gitStore.test.ts`: fixture `files` → `staged`/`unstaged`.
- gitStore 본체 변경 없음(구조만 반영).

## 9. Non-Goals (재확인)
diff 뷰에서 직접 stage/unstage 액션 · 탭 전환 UI · 헌크 단위 stage · old_path 기준 rename 머지.
