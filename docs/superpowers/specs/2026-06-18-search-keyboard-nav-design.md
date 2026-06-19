# 검색 결과 키보드 내비게이션 설계 문서

- 작성일: 2026-06-18
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: 전역 검색(SearchPanel) 완료. 검색 MVP에서 비범위로 미뤘던 항목.

## 1. 개요

검색 패널에서 키보드만으로 결과를 탐색·열 수 있게 한다.

- `↑`/`↓` — 매치 사이 이동(파일 경계 넘어 평면 이동)
- `Enter` — 선택된 매치 열기(파일 열고 해당 위치로 이동)
- 포커스는 검색 입력창에 유지(검색 후 바로 방향키로 결과 탐색). 파일 헤더는 내비게이션 대상 아님.

## 2. 아키텍처 (SearchPanel 로컬 — App 변경 없음)

`onOpenMatch`는 이미 배선돼 있으므로 변경은 `SearchPanel` 내부에 한정된다.

### 2.1 평면 매치 리스트
현재 SearchPanel은 `response.files`를 그룹으로 렌더하고, 접힌 파일(`collapsed` Set)은 매치를 숨긴다. 내비게이션 대상은 **펼쳐진 파일의 매치만**, 표시 순서대로의 평면 리스트로 정의한다:
```ts
interface FlatMatch { path: string; line: number; matchStart: number; matchEnd: number; }
// response.files (collapsed 제외)를 순회해 표시 순서대로 FlatMatch[] 구성.
// path 는 file.path(절대경로, onOpenMatch/openAt가 쓰는 값) — rel_path 아님.
// line/matchStart/matchEnd 는 LineMatch.line_number/match_start/match_end 매핑.
```

### 2.2 상태 & 키 처리
- `const [selectedIndex, setSelectedIndex] = useState(-1);` (-1 = 선택 없음)
- **모든 `setResponse` 경로와 같은 위치에서 `setSelectedIndex(-1)` 호출** — 즉 `setResponse(result)`(검색 결과)와 `setResponse(null)`(빈 쿼리) 둘 다. 같은 렌더에 배치(useEffect로 분리 금지)해, 새 결과와 옛 selectedIndex가 한 렌더에서 어긋나는 창을 없앤다.
- 검색 입력창 `onKeyDown`:
  - **IME 가드 (한국어 필수)**: `e.nativeEvent.isComposing`(또는 `e.isComposing`)가 true면 Arrow·Enter 모두 **그대로 통과**(조합 중 Enter는 음절 확정이므로 가로채면 안 됨). 핸들러 맨 앞에서 `if (e.nativeEvent.isComposing) return;`.
  - `ArrowDown` → `e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, flat.length - 1))`
  - `ArrowUp` → `e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0))`
  - `Enter` → **범위 가드** `if (selectedIndex < 0 || selectedIndex >= flat.length) return;` 통과 시 `e.preventDefault()` 후 `const m = flat[selectedIndex]; onOpenMatch(m.path, m.line, m.matchStart, m.matchEnd)`
  - 그 외 키는 그대로(타이핑).
  - `flat.length === 0`이면 방향키/Enter 모두 no-op(범위 가드로 자연히 보장).

### 2.3 선택 표시 & 스크롤
- **평면 인덱스 단일 출처(off-by-one 방지)**: 네비게이션용 `flat: FlatMatch[]`를 한 번 만든 뒤, 렌더에서 행의 평면 인덱스를 별도 로직으로 다시 세지 않는다. 렌더 직전에 `flat`을 동일하게(접힌 파일 제외, 같은 순서) 만들고, 파일 그룹을 돌며 **누적 카운터**(펼쳐진 파일의 매치마다 +1; 접힌 파일은 건너뜀)로 각 행의 평면 인덱스를 부여한다 — 즉 `flat` 구성과 행 인덱싱이 **같은 순회·같은 필터**를 쓴다. (대안: 행에서 `flat.findIndex(f => f.path===file.path && f.line===m.line_number && f.matchStart===m.match_start)`로 조회. 누적 카운터 권장.)
- 행의 평면 인덱스 `=== selectedIndex`면 선택 스타일(예: `bg-white/10`) 적용. (기존 hover 스타일과 병존)
- 선택된 행에 `ref`를 달고, `selectedIndex` 변경 시 `ref.current?.scrollIntoView?.({ block: "nearest" })`로 보이게(긴 결과 목록 대비). jsdom에서 `scrollIntoView` 미구현이므로 `?.`로 가드.
- `aria-selected`를 선택 행에 부여(접근성).

### 2.4 Enter → 열기
기존 `onOpenMatch(path, line, matchStart, matchEnd)` 재사용. 파일을 열고 매치를 선택·스크롤하며 에디터에 포커스가 간다(기존 동작). 이후에도 입력창으로 다시 포커스가 필요하면 사용자가 검색 버튼/클릭으로 복귀(범위 밖의 포커스 관리는 추가 안 함).

## 3. 데이터 흐름
타이핑 → 디바운스 검색 → 응답 → `selectedIndex = -1`. `↓`로 첫 매치(인덱스 0) 선택 → 하이라이트 + 스크롤. `Enter` → `onOpenMatch` → 파일/위치 이동.

## 4. 엣지 / 에러
- 결과 0개 → 방향키/Enter no-op.
- 접힌 파일의 매치 → 평면 리스트에서 제외(내비게이션·Enter 대상 아님). 파일을 펼치면 다시 포함.
- **파일 접기/펼치기 시 선택 초기화**: `toggleCollapse`에서 `setSelectedIndex(-1)`. (접으면 평면 리스트가 바뀌어 선택이 엉뚱한 매치로 옮겨가는 것 방지.)
- `selectedIndex`는 항상 `[-1, flat.length-1]` 범위. 새 응답마다 -1로 리셋되므로(§2.2) 결과 변동으로 인덱스가 범위를 벗어나는 상황은 발생하지 않는다(렌더 시에도 `index === selectedIndex` 비교만 하므로 안전).
- 선택 없음(-1)에서 `Enter` → no-op.
- 입력창에서 `ArrowUp/Down`은 `preventDefault`로 캐럿 이동을 막고 내비게이션에 사용.

## 5. 테스트 (`SearchPanel.test.tsx`)
- 결과가 있는 상태에서 입력창에 `ArrowDown` → 첫 매치가 선택(`aria-selected`/하이라이트), 한 번 더 → 다음 매치.
- `ArrowUp` → 이전 매치로 이동(0에서 더 누르면 0 유지).
- 선택 후 `Enter` → `onOpenMatch`가 그 매치의 `(path, line, matchStart, matchEnd)`로 호출됨.
- 결과 0개에서 `ArrowDown`/`Enter` → `onOpenMatch` 미호출, 에러 없음.
- 파일 접기 시 선택 초기화(`toggleCollapse` 후 선택 없음).
- (기존 SearchPanel 테스트 유지: 디바운스 검색, 그룹 렌더, 하이라이트, 클릭 열기, 빈 쿼리, regex_error, 입력 자동 포커스)
- **수동 검증(IME)**: jsdom은 한글 조합(`isComposing`)을 충실히 시뮬레이션 못 함 → `tauri dev`에서 한글로 검색어 입력 중 Enter가 음절을 정상 확정하고(매치를 열지 않고), 조합이 끝난 뒤 Enter가 매치를 여는지 직접 확인.

## 6. 범위 밖 (Non-Goals)
- 파일 헤더 내비게이션(헤더에서 Enter로 접기/펼치기)
- `Home`/`End`/`PageUp`/`PageDown`
- 순환(마지막에서 ↓ → 처음으로)
- 타입어헤드(글자 입력으로 점프)
- 마우스 hover ↔ 키보드 선택 동기화
- 접힌 파일 자동 펼침
