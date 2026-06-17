# 전역 검색 (Find in Files) 설계 문서

- 작성일: 2026-06-17
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: zk-code-editor MVP (뷰어·편집·하이라이팅·탐색기) 완료 + 다크 리디자인 적용

## 1. 개요

워크스페이스 전체 파일에서 텍스트를 찾는 **find-in-files** 기능. VS Code의 검색 패널과 동일한 사용감을 목표로 하되 **찾기 전용**(치환 없음)으로 시작한다.

- 액티비티 바의 **Search** 아이콘 → 사이드바가 Explorer ↔ Search로 전환
- 쿼리 입력 + 옵션(대소문자·정규식) → 결과를 **파일별 그룹**으로 표시(줄 번호 + 하이라이트 미리보기)
- 매치 클릭 → 해당 파일을 열고 그 매치를 **선택(select) + 스크롤**

## 2. 기술 스택 / 엔진 선택

- 백엔드: Rust. 워크스페이스 워킹은 **`ignore` 크레이트**(ripgrep과 동일), 매칭은 **`grep-searcher` + `grep-regex` + `grep-matcher`** (ripgrep 라이브러리 스택). 바이너리 감지·줄 종결·CRLF·스트리밍 읽기를 검증된 코드로 처리.
- 프론트: 기존 React 18 + TS + Tailwind + Zustand. CodeMirror 6.
- 손수 `regex`로 줄 매칭하지 않는다(엣지케이스 재구현 회피).

## 3. 아키텍처

기존 2계층 구조를 따른다.

- **Rust `src-tauri/src/search.rs`** (신규): `async` 명령 `search_workspace`. 내부에서 `tokio::task::spawn_blocking`으로 파일 워킹/매칭을 수행(IPC 워커 스레드 블로킹 방지). 워크스페이스 루트는 명령 진입 시 `Workspace` 상태에서 **클론**해 잠금을 길게 잡지 않는다.
- **프론트 `SearchPanel`** (신규): 쿼리·옵션·결과·로딩을 **로컬 상태**로 관리. 뷰 전환 상태 `activeView`만 store에 둔다.
- **사이드바 전환**: `activeView: 'explorer' | 'search'` (store). 액티비티 바의 Explorer/Search 버튼이 토글, 사이드바가 해당 패널을 렌더.

## 4. 백엔드 명령

### 4.1 시그니처 / 타입

```
async search_workspace(query: String, opts: SearchOptions) -> Result<SearchResponse, AppError>

SearchOptions = { case_sensitive: bool, regex: bool }

SearchResponse = {
  files: Vec<FileMatches>,
  total_matches: usize,
  truncated: bool,
  regex_error: Option<String>,   // 잘못된 정규식: walk 없이 이것만 채워 반환
}

FileMatches = {
  path: String,       // read_dir 와 동일한 절대경로 문자열 형식 (entry.path().to_string_lossy())
  rel_path: String,   // 루트 기준 상대경로 — 표시 전용
  matches: Vec<LineMatch>,
}

LineMatch = {
  line_number: u32,            // 1-based
  preview: String,             // 길이 상한으로 절단된 줄 미리보기
  highlight_ranges: Vec<[u32; 2]>,  // preview 문자열 기준 UTF-16 코드유닛 오프셋 [start,end], 정렬·비중첩·클립 보장
  match_start: u32,            // 원본 줄 기준 UTF-16 오프셋 (선택용)
  match_end: u32,
}
```

- 모든 `[u32;2]`/오프셋은 **u32**(미리보기 길이 상한에 불필요한 65535 천장 회피).

### 4.2 동작

1. `Workspace.root()`가 `None`이면 `AppError{code: Io, message: "no workspace open"}` 반환(기존 패턴과 일치).
2. **빈/공백 쿼리** → 즉시 `SearchResponse{ files: [], total_matches: 0, truncated: false, regex_error: None }`. walk 하지 않음(전체 매치 페이로드 폭탄 방지).
3. 매처 구성:
   - `regex=false` → 쿼리를 리터럴로 이스케이프한 정규식.
   - `case_sensitive=false` → case-insensitive 플래그.
   - 컴파일 실패(잘못된 정규식) → walk 없이 `regex_error: Some(메시지)` 반환.
4. `ignore::WalkBuilder`로 루트 하위 순회:
   - `.gitignore`/`.ignore` 존중, 숨김 파일 스킵, `node_modules` 등 기본 제외(크레이트 기본 + 표준 git 무시).
   - **심링크 비추적**(기본값) — 루프 회피 + `resolve_in_workspace`의 비-canonicalize 철학과 일치.
   - **결정적 순서**: `sort_by_file_name`(또는 동등)으로 정렬 → 상한 적용이 재현 가능.
5. 각 파일:
   - `std::fs::metadata().len() > MAX_TEXT_BYTES(5MB, fs_ops와 공유 상수)` → 스킵(검색 가능 == 열기 가능 일치).
   - `grep-searcher`로 검색, `BinaryDetection::quit(0)`로 바이너리 스킵.
   - 매치 줄마다 `LineMatch` 생성.
6. **오프셋 변환 체인** (가장 실수 잦은 부분 — 명시):
   - (a) ripgrep이 주는 **바이트** 매치 범위 확보.
   - (b) 원본 줄에서 **UTF-16** 오프셋으로 변환 → `match_start/match_end`.
   - (c) 미리보기 절단: 줄을 미리보기 길이 상한까지 **문자(grapheme) 경계로** 자른다(UTF-8 중간/서로게이트 중간 절단 금지).
   - (d) 매치 바이트 범위를 **절단된 preview 기준** 문자→UTF-16 오프셋으로 매핑 → `highlight_ranges`.
   - (e) preview 범위를 벗어난 부분은 클립/제외. 결과는 정렬·비중첩.
7. **상한** (초과 시 `truncated: true`). 기본값:
   - 파일 수 ≤ **1000**, 전체 매치 ≤ **5000**, 파일당 매치 ≤ **500**, 줄당 `highlight_ranges` ≤ **100**, preview 길이 ≤ **400** UTF-16 코드유닛.
   - 상수로 한 곳에 모아 정의(추후 설정화 여지). 정렬된 순회 덕에 "처음 N개"가 결정적.
8. 인플라이트 취소는 하지 않음(`async` 명령은 JS에서 abort 불가). 프론트의 seq 가드로 **늦게 온 결과를 무시**하는 방식(취소 아님). 빠른 타이핑 시 blocking 스레드가 잠시 쌓일 수 있음 — 디바운스로 완화.

## 5. 줄 이동 (Reveal) — EditorPane 통합

검색 결과 클릭 시 해당 파일의 매치로 이동. EditorPane은 현재 `path` 변경 시에만 재생성되고 위치 API가 없으므로 최소 변경으로 추가한다.

### 5.1 App 흐름 — `openAt`
```
async function openAt(path, line, matchStart, matchEnd) {
  if (열려있지 않음) { await openFile(path); }   // 비동기 readFile → openTab; 반드시 await
  else if (활성 탭이 아님) { setActive(path); }
  setReveal({ path, line, matchStart, matchEnd, seq: prevSeq + 1 });  // 그 다음 호출
}
```
- App에 `reveal: { path, line, matchStart, matchEnd, seq } | null` 상태.
- EditorPane에는 `reveal.path === activeTab.path`일 때만 prop으로 전달(아니면 `undefined`).

### 5.2 EditorPane — reveal 적용
- 기존 mount effect는 `[path]` 유지(문서 소유 모델 불변).
- **별도 effect `[reveal?.seq]`**: `viewRef.current`로 다음을 수행
  - `line`을 `[1, doc.lines]`로 **클램프**(검색 이후 파일이 바뀌었을 수 있음 → `doc.line` 패닉 방지).
  - `from = doc.line(clampedLine).from + matchStart`, `to = ... + matchEnd`, 각각 줄 끝/`doc.length`로 클램프.
  - `view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) })` + `view.focus()`.
- **open-from-scratch 케이스**: `await openFile` 후 새 탭이 활성→EditorPane이 `key={path}`로 **재마운트**. 마운트 시 모든 effect가 실행되므로 reveal effect도 발화한다(즉 이 경우 reveal을 발화시키는 것은 seq 변화가 아니라 **mount**). `reveal`이 첫 렌더에 정의돼 전달되도록 5.1의 호출 순서를 지킨다.
- **이미 열림+비활성 케이스**: `setActive(path)`로 활성 탭 전환 → 대상 pane 재마운트 → reveal 적용.
- **같은 매치 재클릭**: `seq` nonce 덕에 동일 줄이라도 effect 재실행.

## 6. 프론트엔드 컴포넌트 / 상태

- **store 추가**: `activeView: 'explorer' | 'search'` + `setActiveView`.
- **ActivityBar**: Explorer/Search 두 버튼(`aria-label="Explorer"` / `"Search"`, 활성 뷰에 `aria-pressed`). 동작 규칙(VS Code식, 모호함 제거):
  - 다른 뷰의 버튼 클릭 → 그 `activeView`로 전환하고 사이드바를 연다(숨겨져 있었으면 표시).
  - **현재 활성 뷰**의 버튼 재클릭 → 사이드바를 접는다(토글).
  - 즉 사이드바 표시 상태(`sidebarVisible`)와 `activeView`를 함께 갱신. 기존 Explorer 단독 토글 동작을 이 규칙으로 일반화한다.
- **App**: 사이드바 영역이 `activeView`에 따라 `<FileExplorer>` 또는 `<SearchPanel>` 렌더.
- **SearchPanel** (신규, 로컬 상태 `{ query, caseSensitive, regex, response, loading, regexError, seq }`):
  - 쿼리/옵션 변경 → **~200ms 디바운스** 후 `searchWorkspace` 호출. 호출 시 `seq` 캡처, 응답이 최신 seq가 아니면 폐기(stale 가드).
  - **빈/공백 쿼리** → 결과 즉시 비움(walk 호출 안 함).
  - **뷰 전환 시 결과 유지**(재검색 비용 큼). 결과는 쿼리/옵션 변경 또는 워크스페이스 루트 변경 시에만 갱신.
  - 렌더: 옵션 토글(`Aa` 대소문자 / `.*` 정규식), 요약("N results in M files", `truncated`면 "showing first N" 안내), `regex_error`면 입력창 아래 인라인 안내.
  - **파일 그룹**: 접기 가능(접힌 경로 `Set<string>` — **절대경로 키**). 헤더에 `rel_path` + 매치 수 배지.
  - **매치 행**: `preview`를 `highlight_ranges`로 스팬 분할(백엔드가 정렬·비중첩·UTF-16=JS `.length` 기준 보장 → 단순 선형 slice). 클릭 → `onOpenMatch(path, line_number, match_start, match_end)`.
- **api/fs.ts**: `searchWorkspace(query, opts)` 래퍼 추가.

## 7. 에러 처리

- **워크스페이스 없음**: `AppError{Io}` → 기존 **`notice` 배너** 재사용(새 토스트 인프라 도입 안 함).
- **잘못된 정규식**: 에러 아님 — `regex_error`로 패널 입력창 아래 인라인 안내(반쯤 입력한 패턴마다 reject 방지).
- **truncated**: 요약줄에 "처음 N개만 표시" 안내.
- **클릭한 파일이 그새 삭제/바이너리/대용량**: `openFile`이 기존 경로대로 처리(바이너리/대용량 → notice, 탭 안 열림). reveal은 적용 안 됨(안전).

## 8. 테스트 전략

- **Rust** (`tempfile` 픽스처, fs_ops 패턴):
  - `.gitignore`/`node_modules`/숨김/바이너리 파일이 결과에서 제외되는지.
  - **멀티바이트 UTF-8 파일**에서 `highlight_ranges`/`match_start/end`가 올바른 **UTF-16** 오프셋인지(핵심 회귀 방지).
  - 상한 초과 시 `truncated:true` + **결정적 순서**(정렬 워킹) 검증.
  - 빈 쿼리·잘못된 정규식 경로.
- **프론트** (Storybook/vitest, `searchWorkspace` 모킹):
  - SearchPanel: 파일 그룹 렌더·접기, 옵션 토글, 하이라이트 스팬 분할, **seq 가드(늦은 응답 폐기)**, 빈 쿼리 시 결과 비움.
  - EditorPane reveal: 매치 선택·스크롤, **줄 클램프**(doc 끝 초과) 경로.
  - ActivityBar: Search 토글이 `activeView` 변경.
  - 통합: **이미 열림+비활성** 매치 클릭이 탭을 활성화.
- **수동**: `tauri dev`로 실제 레포 검색 → 그룹/하이라이트/클릭 이동 확인.

## 9. 범위 밖 (Non-Goals, MVP)

- 치환(replace / replace-all)
- 스트리밍 결과(증분 표시) — 동기+상한으로 시작
- 검색 히스토리
- include/exclude glob 입력 UI, "무시 파일 포함" 토글
- 멀티 루트 워크스페이스
- **결과 목록 키보드 내비게이션**(↑/↓/Enter) — 포커스 관리(reveal의 editor focus와 충돌)와 함께 추후
