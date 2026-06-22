# Diff 파일 네비게이터 설계 문서

- 작성일: 2026-06-22
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: Git Diff 뷰(`2026-06-22-git-diff-view-design.md`) 완료. 거기서 후속으로 미뤘던 "사이드바 점프 목록"을 DiffView 내부 좌측 패널로 구현.

## 1. 개요

DiffView(연속 unified diff) 안에 **좌측 파일 네비게이터 패널**을 추가한다(GitHub "Files changed" 좌측 목록 스타일). 항목 클릭 시 해당 파일 섹션으로 스크롤하고, 스크롤 위치에 따라 현재 보이는 파일을 목록에서 **자동 하이라이트**한다.

### 1.1 범위
- 좌측 고정폭 파일 목록(상태·경로·±), 우측 기존 연속 diff 2단 레이아웃.
- 클릭 → 해당 파일 헤더로 스크롤(`align: "start"`).
- 스크롤 시 현재 최상단 파일 자동 하이라이트(클릭 하이라이트와 동일 메커니즘).
- 읽기 전용. 백엔드/타입 변경 없음(기존 `GitChanges` 재사용).

### 1.2 비범위
파일 트리(디렉토리 계층) 표현 · 다중 선택 · 키보드 내비게이션 · 파일 목록 접기/필터.

## 2. 레이아웃 (DiffView)

기존 DiffView는 `상단 헤더바 + 본문(가상화 스크롤)` 구조다. 변경 후:

```
DiffView (flex col)
├─ headerBar (브랜치 · 변경 수 · Refresh)          ← 전체폭 유지
└─ 본문 (flex row)
   ├─ DiffFileList  (좌, 고정폭 w-56, zk-scroll)     ← 신규
   └─ diff 스크롤 컨테이너 (우, flex-1, 기존 가상화)
```

- **2단은 "파일 있는 상태"에서만.** loading / error / `!is_repo` / no-changes는 기존처럼 본문 전체폭 중앙 메시지(좌측 목록 미표시).
- 좌측 패널 자체도 스크롤 가능(`zk-scroll`, 파일이 많을 때).

## 3. 컴포넌트

### 3.1 `DiffFileList` (DiffView.tsx 내부에 정의)
props: `files: FileDiff[]`, `activePath: string | null`, `onSelect: (path: string) => void`.
- 각 행: 상태 배지(M/A/D/R/U) · 경로(리네임은 `path` 표시, 좁으면 truncate) · `+N`/`−M`.
- `path === activePath` 행은 하이라이트(예: `bg-white/10`).
- 행 클릭 → `onSelect(path)`.

### 3.2 DiffView 변경
평탄화 루프에서 rows와 함께 두 보조 구조를 만든다:
- `pathToRowIndex: Map<string, number>` — 각 파일-헤더 행의 rows 인덱스(클릭 스크롤용).
- `fileOffsets: { path: string; top: number }[]` — 각 파일-헤더 행의 누적 픽셀 오프셋(자동 하이라이트용). `top`은 그 행 이전까지의 `ROW_H[kind]` 합.

활성 파일은 **상태가 아니라 파생값**이다(스크롤 위치 기준):
```ts
const activePath = activeFileForOffset(fileOffsets, virtualizer.scrollOffset ?? 0);
```
- 가상화는 스크롤마다 리렌더되므로(virtualizer가 scrollOffset를 상태로 보유) 매 렌더에서 재계산되어 하이라이트가 스크롤을 따라간다.
- 클릭 → `virtualizer.scrollToIndex(pathToRowIndex.get(path)!, { align: "start" })` → 스크롤 변경 → 다음 렌더에서 activePath가 그 파일로 갱신(별도 selected 상태 불필요).

### 3.3 순수 헬퍼 `activeFileForOffset`
```ts
export function activeFileForOffset(
  files: { path: string; top: number }[],
  offset: number
): string | null {
  let active: string | null = files[0]?.path ?? null;
  for (const f of files) {
    if (f.top <= offset + 1) active = f.path; // +1: 경계 오차 흡수
    else break;
  }
  return active;
}
```
`files`는 `top` 오름차순(평탄화 순서대로 자연히 정렬). jsdom 스크롤 이벤트 불안정성을 피하기 위해 이 로직만 분리해 단위 테스트한다.

## 4. 데이터 흐름
`gitStore.changes.files` → (DiffView 평탄화) rows + pathToRowIndex + fileOffsets → DiffFileList(목록) & 가상화 본문. 클릭은 본문 virtualizer를 스크롤하고, 본문 스크롤은 activePath를 갱신해 목록 하이라이트를 동기화한다. 단방향 + 파생으로 순환 없음.

## 5. 에러 / 엣지
- 파일 없음/비-저장소/로딩/에러: 좌측 목록 미표시(전체폭 메시지).
- 접힌 파일 클릭: 헤더 행은 항상 존재하므로 정상 스크롤(접힘 상태 유지).
- 파일 1개: 목록 1행, 항상 활성.
- 매우 많은 파일: 좌측 패널 자체 스크롤(`zk-scroll`). (좌측 목록 가상화는 비범위 — 변경 파일 수는 보통 수십 규모.)
- `scrollOffset`이 0(최상단): 첫 파일 활성.

## 6. 테스트
- **순수 단위**: `activeFileForOffset` — 오프셋 0 → 첫 파일; 두 번째 파일 top 직전/직후 경계; 마지막 파일; 빈 배열 → null.
- **컴포넌트(DiffView.test.tsx)**: 좌측 목록이 모든 변경 파일을 렌더; 특정(뒤쪽) 파일 클릭 시 diff 스크롤 컨테이너의 `scrollTop`이 0보다 커짐(클릭→스크롤 동작). 기존 DiffView 테스트(렌더/접기/상태)는 유지. (스크롤 위치→하이라이트 자동 동기화의 픽셀 정확도는 jsdom 한계로 수동 검증; 로직은 `activeFileForOffset` 단위 테스트로 커버.)
- **수동**: 실제 저장소에서 클릭 점프 + 스크롤 시 활성 하이라이트 추적.

## 7. 변경 범위
- `src/components/DiffView.tsx`: 좌측 `DiffFileList` 렌더(같은 파일 내 컴포넌트로 정의), `pathToRowIndex`/`fileOffsets` 구성, `activeFileForOffset` 사용, 클릭 핸들러(virtualizer.scrollToIndex), 2단 레이아웃(파일 있는 상태에서만).
- `src/lib/diffNav.ts`(신설): 순수 `activeFileForOffset` + 단위 테스트 `src/lib/diffNav.test.ts`.
- `src/components/DiffView.test.tsx`: 네비게이터 렌더/클릭-스크롤 테스트 추가.
- 백엔드·타입·스토어 변경 없음.

## 8. Non-Goals (재확인)
디렉토리 트리 · 키보드 내비 · 목록 필터/접기 · 좌측 목록 가상화 · 스테이징 액션.
