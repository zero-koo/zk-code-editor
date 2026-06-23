# Diff 구문 강조 (전체 파일 컨텍스트) 설계 문서

- 작성일: 2026-06-23
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: Git Diff 뷰 + 파일 네비게이터 완료. Diff 뷰 스펙에서 후속으로 미뤘던 "구문 강조".

## 1. 개요

DiffView의 줄을 **전체 파일 컨텍스트로 정확히 구문 강조**한다(블록 주석·멀티라인 문자열도 정확). diff에는 헌크 줄 텍스트만 있으므로, 백엔드가 변경 파일의 신/구 전체 내용을 제공하고, 프론트가 그 전체 내용을 Lezer로 파싱·강조한 뒤 줄 번호로 매핑한다. 색상은 에디터(`zkHighlight`)와 동일하게 재사용한다.

### 1.1 범위
- 전체-파일 컨텍스트 강조(per-line 아님). 색상은 기존 CodeMirror HighlightStyle 재사용(새 하이라이팅 라이브러리 없음).
- 텍스트 파일만. 바이너리/초대용량/내용 없음/언어 미지원 → 기존 플레인 색상 diff 폴백.
- 읽기 전용 표시. diff 구조/네비게이터 동작 불변.

### 1.2 비범위
intra-line(단어 단위) diff 강조 · diff 자체의 추가/삭제 배경색 변경(유지) · 새 언어 추가.

## 2. 백엔드 (`src-tauri/src/git.rs`, `fs_ops.rs`)

### 2.1 `FileDiff`에 내용 필드 추가
```
new_text: Option<String>,  // 작업트리(신) 내용; 텍스트일 때만. 삭제 파일은 None.
old_text: Option<String>,  // HEAD(구) 내용; 텍스트일 때만. 추가/untracked·HEAD없음은 None.
```
(serde snake_case, 기존 관례 동일.)

### 2.2 채우기 (`compute_changes` 후처리)
`parse_diff`/untracked 합성으로 `files`를 만든 뒤 각 파일에 대해:
- **new_text**: 삭제(status "deleted")가 아니면 `detect_file(root.join(path))` → `Text(t)`면 `Some(t)`, 그 외(바이너리/초대용량/없음/에러) `None`. (untracked도 작업트리에 존재하므로 동일하게 채워짐.)
- **old_text**: 추가(status "added")/untracked가 아니면 `git -C root show HEAD:<ref>` (ref = `old_path` 우선, 없으면 `path`). 명령 성공 시 stdout 바이트를 `classify_bytes`로 분류 → `Text(t)`면 `Some(t)`, 그 외 `None`. 실패(HEAD에 없음 등) → `None`.

### 2.3 `fs_ops` 리팩터
`detect_file`의 바이트 분류 부분을 `pub fn classify_bytes(bytes: Vec<u8>) -> FileContent`로 추출(크기 검사는 `bytes.len()` 기준). `detect_file`은 metadata 크기 확인 후 `classify_bytes` 호출. git.rs의 old_text가 `classify_bytes`를 재사용한다. 기존 fs_ops 동작/테스트 불변.

### 2.4 성능/주의
파일당 `git show` 1회 추가(N 파일 → N 호출). 작업트리 변경 규모에선 무난. `spawn_blocking` 안에서 수행(기존과 동일).

## 3. 프론트 강조 엔진 (`src/lib/diffHighlight.ts` 신설)

### 3.1 Lezer 파서 접근 (`language.ts`에 추가)
```ts
import { LanguageSupport, Language } from "@codemirror/language";
import type { Parser } from "@lezer/common";
export function lezerParserFor(id: string): Parser | null {
  const ext = languageExtension(id);
  const lang =
    ext instanceof LanguageSupport ? ext.language : ext instanceof Language ? ext : null;
  return lang ? lang.parser : null;
}
```
(`StreamLanguage`는 `Language`를 상속하므로 go/shell도 처리. plaintext/`[]` → null.)

### 3.2 색상 재사용
`editorTheme.ts`에서 `zkHighlight`(HighlightStyle)를 **export**한다. `diffHighlight.ts`는 `zkHighlight`를 `highlightTree`의 highlighter로 그대로 사용하고, 그 StyleModule을 문서에 1회 mount해 cb가 주는 className이 에디터와 **동일한 색**을 갖게 한다:
```ts
import { StyleModule } from "style-mod"; // package.json에 명시 추가(현재 transitive)
let mounted = false;
function ensureStyles() {
  if (!mounted && zkHighlight.module) { StyleModule.mount(document, zkHighlight.module); mounted = true; }
}
```
(EditorPane이 이미 mount해도 `StyleModule.mount`는 중복 제거되므로 안전.)

### 3.3 `highlightToLines`
```ts
export interface Segment { text: string; className?: string; }

// 전체 텍스트를 파싱·강조해 줄별 세그먼트 배열로. 인덱스 = (줄번호 - 1).
export function highlightToLines(text: string, languageId: string): Segment[][];
```
알고리즘:
1. `parser = lezerParserFor(languageId)`; 없으면 → 각 줄을 `[{text: line}]`로(플레인).
2. `ensureStyles()`; `tree = parser.parse(text)`.
3. `highlightTree(tree, zkHighlight, (from, to, classes) => ...)`로 스타일 구간을 순서대로 수집하되, 구간 사이 빈틈은 className 없는 세그먼트로 채운다(커서 `pos` 추적; 끝의 나머지도 채움).
4. 수집한 전역 세그먼트를 `\n` 기준으로 분할해 줄별 `Segment[]`로 재배열(개행마다 새 줄 시작).
5. 반환 길이 = `text`의 줄 수.

### 3.4 캐시
모듈 레벨 `Map<string, Segment[][]>`를 텍스트 문자열로 키. `getHighlightedLines(text, languageId)` = 캐시 조회 후 없으면 `highlightToLines` 계산·저장. `clearHighlightCache()` export(변경 재로드 시 메모리 정리용). 이로써 전체-파일 파싱은 **파일 텍스트당 1회**.

## 4. DiffView 통합

- `api/types.ts` `FileDiff`에 `new_text: string | null`, `old_text: string | null` 추가.
- 평탄화에서 line row에 강조에 필요한 참조를 싣는다: `langId: string`, `newText: string | null`, `oldText: string | null`(파일에서 파생; 문자열 참조라 저렴).
- `renderRow`의 line 분기에서 **지연 강조**:
  - 사이드 결정: `del` → `oldText`/`oldNo`, 그 외(add/context) → `newText`/`newNo`.
  - `sideText` 있으면 `getHighlightedLines(sideText, langId)[lineNo-1]` 세그먼트 사용. 없으면(바이너리/대용량/누락/미지원) 기존 플레인 텍스트.
  - **안전 가드**: 세그먼트들의 텍스트 합이 row.text와 다르면(예: 드문 불일치) 플레인 폴백.
  - 세그먼트는 `<span className=...>`들로 렌더(현재 단일 텍스트 자리 대체).
- 강조는 `renderRow`(가상화로 보이는 줄만 호출)에서 일어나므로 **보이는 파일만, 첫 줄 렌더 시 1회 전체 파싱**되고 이후 캐시 사용.
- DiffView가 `changes` 변경 시 `clearHighlightCache()` 호출(useEffect `[changes]`)로 캐시 정리.

## 5. 에러 / 엣지
- 바이너리/초대용량/언어 미지원/내용 None → 플레인 색상 diff(기존 그대로).
- 삭제 파일: new_text None → del 줄은 old_text로 강조. 추가/untracked: old_text None → add 줄은 new_text로 강조.
- 멀티라인 구문: 전체 파싱이라 정확.
- 줄 텍스트 불일치(예: 끝 개행/드문 케이스) → 해당 줄 플레인 폴백.
- HEAD 없음(unborn): old_text 전부 None → 강조는 new_text 기반만.

## 6. 테스트
- **Rust**: `git show HEAD:` old_text 통합 — 수정 파일은 old_text=HEAD 내용·new_text=작업 내용; 추가 파일 old_text None; 삭제 파일 new_text None·old_text=HEAD. `classify_bytes` 단위(텍스트/널바이트/초대용량).
- **프론트 단위(`diffHighlight.test.ts`)**: `highlightToLines("const x = 1\nconst y = 2", "typescript")` → 2줄, 첫 줄에 `const` 토큰이 className 있는 세그먼트로 분리됨(키워드 강조 확인); 미지원 언어/빈 텍스트 → 플레인 세그먼트; 줄 수 == 개행+1.
- **DiffView**: 강조된 토큰 span이 렌더되는지(예: 키워드 클래스 있는 span 존재), 바이너리/미지원은 플레인. 기존 DiffView/네비게이터 테스트 유지.

## 7. 변경 범위
- `src-tauri/src/git.rs`: new_text/old_text 채우기(+ `git show`), `src-tauri/src/fs_ops.rs`: `classify_bytes` 추출.
- `src/api/types.ts`: `FileDiff`에 new_text/old_text.
- `src/lib/language.ts`: `lezerParserFor`.
- `src/lib/editorTheme.ts`: `zkHighlight` export.
- `src/lib/diffHighlight.ts`(신설) + 테스트.
- `src/components/DiffView.tsx`: line row에 langId/newText/oldText, renderRow 강조 렌더, clearHighlightCache 효과.
- `package.json`: `style-mod` 명시(현재 transitive).

## 8. Non-Goals (재확인)
intra-line diff · 추가/삭제 배경색 변경 · 새 언어 추가 · 강조 테마 변경.
