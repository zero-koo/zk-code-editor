# Diff 컨텍스트 확장 (숨겨진 영역 펼치기) 설계 문서

- 작성일: 2026-06-23
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: Git Diff 뷰 + 파일 네비게이터 + 구문 강조 완료. `new_text`/`old_text`(전체 파일 내용)가 이미 FileDiff에 있음.

## 1. 개요

GitHub "Files changed"처럼, 헌크 사이·위·아래의 **숨겨진 미변경 줄**을 위/아래(▲/▼) 확장 컨트롤로 펼친다. 펼칠 내용은 이미 받아온 `new_text`에서 계산하므로 **백엔드 변경 없음**.

### 1.1 범위
- 고정 스텝(20줄) 위/아래 확장. 남은 간격 ≤20이면 한 번에 전체.
- `new_text`가 있는 파일만(modified/added/renamed/untracked 텍스트). 바이너리/대용량/삭제(=new_text 없음)는 컨트롤 없음.
- 펼친 줄은 구문 강조 적용(기존 엔진 재사용). 백엔드/타입/스토어 변경 없음.

### 1.2 비범위
사이 간격 전체 펼침 시 가운데 `@@` 헤더 숨김(후속) · old_text 기반 삭제파일 컨텍스트 · 전체-펼침 단일 버튼.

## 2. 라인번호 모델 (리뷰 핵심)

### 2.1 헌크 경계 (non-null 스캔)
헌크의 첫/마지막 줄은 add(old_no=null)·del(new_no=null)일 수 있으므로 **첫·마지막 non-null** 값을 스캔한다:
- `firstNew` = 헌크 줄들 중 첫 non-null `new_no`(= 헤더 newStart), `firstOld` = 첫 non-null `old_no`(= 헤더 oldStart).
- `lastNew` = 마지막 non-null `new_no`, `lastOld` = 마지막 non-null `old_no`.

### 2.2 간격(gap)과 delta
미변경 구간은 old↔new 오프셋이 일정 → 펼친 new 줄 L의 `oldNo = L − delta`.
- **첫-헌크-앞**: new 범위 `[1, firstNew(h0)−1]`, `delta = firstNew(h0) − firstOld(h0)`(구조상 0이지만 식으로 도출), `beforeHunkIndex=0`, 방향: ▲만(다음 헌크 있음, 이전 없음).
- **헌크 사이 i,i+1**: `[lastNew(hi)+1, firstNew(hi+1)−1]`, `delta = firstNew(hi+1) − firstOld(hi+1)`, `beforeHunkIndex=i+1`, 방향: ▲·▼ 둘 다.
- **마지막-헌크-뒤**: `[lastNew(hlast)+1, totalNewLines]`, `delta = lastNew(hlast) − lastOld(hlast)`, `beforeHunkIndex=hunks.length`, 방향: ▼만.
- 길이(`endNew − startNew + 1`)가 0 이하인 간격은 만들지 않는다(인접 헌크/전체-add 파일은 간격 없음).

### 2.3 totalNewLines (off-by-one 방지)
`new_text`는 보통 끝 개행으로 끝나 `split("\n")`이 끝에 `""`를 남긴다(줄 수 +1). 백엔드와 동일 규칙으로 실제 줄 수 산출:
```ts
const parts = newText.split("\n");
const totalNewLines = parts.length - (parts[parts.length - 1] === "" ? 1 : 0);
```
펼칠 줄 L(1..totalNewLines)의 텍스트 = `parts[L−1]`.

## 3. 방향 의미
- **▼ expand-down**: 간격 **상단**(이전 헌크 직후)부터 아래로 공개 → `top` 증가. 활성 조건 `hasPrev`(이전 헌크 존재).
- **▲ expand-up**: 간격 **하단**(다음 헌크 직전)부터 위로 공개 → `bottom` 증가. 활성 조건 `hasNext`(다음 헌크 존재).
- 첫-앞: ▲만 / 마지막-뒤: ▼만 / 사이: 둘 다. 각 클릭 +20, 간격 상한까지.

## 4. 순수 헬퍼 `src/lib/diffExpand.ts`

```ts
import type { Hunk } from "../api/types";

export interface HunkBounds { firstNew: number; lastNew: number; firstOld: number; lastOld: number; }
export interface GapSpec {
  beforeHunkIndex: number; // 이 인덱스의 헌크 앞 간격(= hunks.length면 마지막-뒤)
  startNew: number; endNew: number; // 숨겨진 new 줄 범위(포함)
  delta: number; hasPrev: boolean; hasNext: boolean;
}
export interface RevealLine { newNo: number; oldNo: number; text: string; }
export interface RevealedGap {
  topLines: RevealLine[]; bottomLines: RevealLine[];
  remaining: number; canUp: boolean; canDown: boolean;
}

export function hunkBounds(h: Hunk): HunkBounds; // 첫/마지막 non-null new_no·old_no 스캔
export function fileGaps(hunks: Hunk[], totalNewLines: number): GapSpec[]; // §2.2, 길이>0만
export function revealGap(
  gap: GapSpec, state: { top: number; bottom: number }, newLines: string[], step: number
): RevealedGap;
```
`revealGap` 로직:
- `len = endNew − startNew + 1`; `top = min(state.top, len)`; `bottom = min(state.bottom, len − top)`(수렴 중복 방지).
- `topLines`: `L ∈ [startNew, startNew+top−1]` → `{ newNo:L, oldNo:L−delta, text:newLines[L−1] }`.
- `bottomLines`: `L ∈ [endNew−bottom+1, endNew]` → 동일.
- `remaining = len − top − bottom`.
- `canDown = hasPrev && remaining>0`; `canUp = hasNext && remaining>0`.

## 5. DiffView 통합

- 상수 `EXPAND_STEP = 20`. 새 Row 종류 `expander`: `{ kind:"expander"; gapKey:string; canUp:boolean; canDown:boolean; remaining:number }`. `ROW_H.expander = 22`.
- 상태: `const [expanded, setExpanded] = useState<Map<string, {top:number; bottom:number}>>(new Map())`. **`useEffect(()=>setExpanded(new Map()), [changes])`** 로 재로드 시 초기화(라인번호 변동). gapKey = `` `${file.path}#${beforeHunkIndex}` `` (한 changes 스냅샷 내 안정).
- 핸들러 `expand(gapKey, dir)`: 해당 gapKey의 `{top|bottom} += EXPAND_STEP`(clamp는 렌더의 revealGap이 담당). `renderRow`에 `toggle`과 함께 전달.
- **평탄화**: 파일이 텍스트·비접힘·`new_text != null`이면 `newLines = split·끝"" 제거`, `gaps = fileGaps(file.hunks, newLines.length)`(beforeHunkIndex로 색인). 헌크 루프에서 헌크 i를 렌더하기 **전에** `beforeHunkIndex==i`인 gap을, 루프 종료 후 `beforeHunkIndex==hunks.length`인 gap을 처리:
  - `r = revealGap(gap, expanded.get(key)??{top:0,bottom:0}, newLines, EXPAND_STEP)`.
  - `r.topLines` → context "line" 행들(newNo=L, oldNo, text, langId, newText=file.new_text). `top += ROW_H.line` 각.
  - `r.remaining>0`이면 expander 행 1개(`top += ROW_H.expander`).
  - `r.bottomLines` → context "line" 행들(`top += ROW_H.line` 각).
  - 그 다음 기존대로 헌크 `@@` 헤더 + 헌크 줄들.
- **펼친 줄의 `text`는 `newLines[L−1]`** 그대로 → renderRow의 `getHighlightedLines(newText, langId)[newNo−1]` + `join===text` 가드로 강조 적용(불일치 시 플레인).
- **`top` 누적/`fileOffsets`**: expander·공개 줄 높이를 `top`에 모두 반영해야 `activeFileForOffset`(파일목록 활성 하이라이트)가 어긋나지 않는다.
- expander 렌더(renderRow): 좌측 거터 영역에 `canDown`이면 ▼, `canUp`이면 ▲ 버튼(클릭 → `expand`), 가운데 `${remaining} hidden lines` 회색 텍스트. 높이 22, `font-mono` 회색 배경(헌크 헤더와 유사).

## 6. 에러 / 엣지
- `new_text` 없음(바이너리/대용량/삭제) → 간격/expander 없음(기존 그대로). status가 아니라 `new_text != null`로 게이트.
- 간격 길이 0(인접 헌크) → expander 없음.
- 추가/untracked(전체-add 단일 헌크) → 모든 간격 길이 0 → expander 없음.
- 끝 개행 없는 파일 → `parts` 끝이 `""` 아님 → totalNewLines 정상(유령 줄 없음).
- 양방향 수렴 → `bottom = min(bottom, len−top)`로 중복/누락 없음. 완전 공개 시 `remaining=0` → expander 사라지고 연속 컨텍스트.

## 7. 테스트
- **순수(`diffExpand.test.ts`)**: `hunkBounds`(add-at-top·del-at-bottom에서도 올바른 first/last); `fileGaps`(첫-앞/사이/마지막-뒤 범위·delta·방향 플래그, 인접 헌크 0길이 제외, 전체-add 파일 → 빈 배열, totalNewLines 끝개행 유/무); `revealGap`(top/bottom clamp, 수렴 시 중복 없음, ≤step 한 번에 전체, oldNo=L−delta).
- **DiffView**: 숨겨진 간격이 있는 diff에서 expander 행이 ▲/▼와 "N hidden lines"로 렌더; ▼ 클릭 시 context 줄이 추가되고 remaining 감소; 완전 공개 시 expander 사라짐; new_text 없는 파일엔 expander 없음. 기존 DiffView 테스트 유지. (가상화 stub 기존 재사용.)
- **수동**: 실제 저장소에서 헌크 사이/위/아래 펼침, 강조 적용, 큰 파일.

## 8. 변경 범위
- `src/lib/diffExpand.ts`(신설) + `src/lib/diffExpand.test.ts`.
- `src/components/DiffView.tsx`: expander Row·ROW_H·expanded 상태·expand 핸들러·평탄화에 간격/공개 줄·renderRow expander 렌더, `top` 누적 반영.
- `src/components/DiffView.test.tsx`: expander 테스트 추가.
- 백엔드·api/types·gitStore 변경 없음.

## 9. Non-Goals (재확인)
완전-펼침 시 `@@` 헤더 숨김 · 삭제파일 컨텍스트(old_text) · 단어 단위 diff · 새 언어.
