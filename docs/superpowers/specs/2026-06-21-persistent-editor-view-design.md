# 영속 EditorView + 경로별 EditorState 캐시 설계 문서

- 작성일: 2026-06-21
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: 프론트엔드 렌더 성능 개선(cursor 분리 / setDirty bail-out / panel memo) 완료. 파일 전환 지연 분석에서 식별한 #1 항목.

## 1. 개요 / 문제

현재 App은 `<EditorPane key={activeTab.path} />`로 렌더하므로, 파일을 전환할 때마다 CodeMirror `EditorView`가 **완전히 파괴 후 재생성**된다. 이때 전체 확장 그래프 재구성 + 문서 전체 Lezer 재파싱이 매번 발생해 전환이 체감상 느리다.

목표: **단일 EditorView를 유지**하고 파일 전환 시 `view.setState()`로 상태만 교체한다. 추가로 **경로별 `EditorState`를 캐시**해, 열린 탭으로 되돌아올 때 재파싱 없이 즉시 표시하고 실행취소 히스토리·커서·스크롤을 보존한다.

### 1.1 결정된 범위 (브레인스토밍)

- **상태 보존**: 경로별 `EditorState` 캐시 — 탭으로 돌아오면 undo 히스토리·커서·스크롤 보존(재파싱 없음).
- **수명**: 세션 내(메모리)만. 앱 재시작/Vite 리로드 시엔 기존처럼 열린 탭 "경로"만 복원되고 내용은 디스크에서 다시 읽는다(EditorState 캐시는 소실).

## 2. 아키텍처

EditorPane을 **앱 수명 동안 한 번만 마운트**되는 컴포넌트로 바꾼다. App의 `key={activeTab.path}`를 제거한다. EditorPane은 활성 탭이 있을 때만 렌더되며(현 동작 유지), 모든 탭이 닫히면 언마운트되어 캐시가 소실된다(드문 엣지로 허용).

### 2.1 App → EditorPane props 변화

- **제거**: `key`
- **추가**:
  - `activePath: string` — 현재 활성 파일 경로(기존 `key`가 담던 정보).
  - `openPaths: string[]` — `tabs.map(t => t.path)`. 캐시 evict 기준.
- **유지**: `languageId`, `initialDoc`(캐시 미스 시 새 state 생성용), `onChange`, `onSave`, `onPersist`, `onCursorChange`, `reveal`.

App은 `activeTab`이 있을 때만 EditorPane을 렌더하고, 없으면 기존 "No file open" 빈 상태를 렌더한다.

### 2.2 EditorPane 내부 상태

모두 ref로 보유(렌더 트리거 아님):

- `viewRef: EditorView | null` — 단일 뷰.
- `cacheRef: Map<string, EditorState>` — 경로별 EditorState.
- `scrollRef: Map<string, number>` — 경로별 `scrollDOM.scrollTop`(스크롤 복원용).
- `currentPathRef: string | null` — 현재 뷰에 올라간 경로.
- `propsRef: { languageId, initialDoc, openPaths, onChange, onSave, onPersist, onCursorChange }` — **렌더 본문에서 동기 할당**(기존 `cbRef` 패턴 확장). 모든 effect는 props를 이 ref로만 읽어 stale 클로저를 피한다.

### 2.3 `buildState(languageId, doc)`

`EditorState.create({ doc, extensions })`로 새 상태 생성. 확장 집합은 현재와 동일:
`lineNumbers()`, `highlightActiveLineGutter()`, `highlightActiveLine()`, `history()`, `keymap.of([...defaultKeymap, ...historyKeymap])`, saveKeymap(Mod-s), `languageExtension(languageId)`, `zkTheme`, updateListener.

- **Compartment 불필요**: 각 EditorState가 자기 파일의 language를 직접 품고, `setState`가 확장 그래프를 통째로 교체하므로 in-place reconfigure가 필요 없다. 현재 코드의 `Compartment`는 제거한다.
- **updateListener**는 `viewRef`/`propsRef`로만 값을 읽어야 한다(특정 렌더의 `view`나 props를 직접 캡처하지 말 것 — 캐시된 state가 stale 참조를 고정하는 누수 방지).

## 3. 생애주기 / 효과

정의 순서(중요): **마운트 효과 → 전환 효과 → reveal 효과 → evict 효과**. React가 effect를 선언 순서로 실행하므로, 같은 커밋에서 전환이 reveal·evict보다 먼저 처리된다.

### 3.1 마운트 효과 (deps `[]`)

1. 최초 `activePath`의 state를 `buildState(propsRef.languageId, propsRef.initialDoc)`로 생성.
2. `new EditorView({ state, parent })` 1회 생성, `viewRef = view`.
3. `currentPathRef = activePath`, `cacheRef.set(activePath, view.state)` — 첫 파일도 캐시에 시드.
4. 최초 커서 보고: `propsRef.onCursorChange?.(cursorInfo(view.state))` (현재 코드와 동일).
5. **cleanup**(언마운트): `propsRef.onPersist?.(currentPathRef.current, view.state.doc.toString())` 후 `view.destroy()`. 캡처된 `path`가 아니라 **`currentPathRef.current`** 기준으로 persist.

### 3.2 전환 효과 (deps `[activePath]`)

```
const view = viewRef.current;
if (!view || !activePath) return;
const prev = currentPathRef.current;
if (prev === activePath) return;                       // no-op (최초 렌더 포함)

// 나가는 파일 저장 — 닫힌 탭이면 건너뜀(누수 방지)
if (prev != null && propsRef.openPaths.includes(prev)) {
  cacheRef.current.set(prev, view.state);
  scrollRef.current.set(prev, view.scrollDOM.scrollTop);
  propsRef.onPersist?.(prev, view.state.doc.toString());
}

// 들어오는 파일 로드
const state = cacheRef.current.get(activePath)
  ?? buildState(propsRef.languageId, propsRef.initialDoc);
view.setState(state);

// C1: setState 는 updateListener 를 발화하지 않으므로 커서를 명시 보고
propsRef.onCursorChange?.(cursorInfo(view.state));

// I3: 스크롤 복원 (setState 는 스크롤을 복원하지 않음)
const top = scrollRef.current.get(activePath);
if (top != null) {
  view.requestMeasure({ read: () => {}, write: () => { view.scrollDOM.scrollTop = top; } });
}

currentPathRef.current = activePath;
```

`openPaths`는 `propsRef`를 통해 최신값으로 읽는다.

### 3.3 reveal 효과 (deps `[reveal?.seq]`)

현재 구현 유지(viewRef 기반 선택 + `scrollIntoView`, 에디터 포커스는 주지 않음). 전환 효과가 먼저 실행되어 새 문서가 올라간 뒤 라인을 계산한다. 라인 클램프(`Math.min/max`)는 그대로 둔다(방어).

### 3.4 evict 효과 (deps `[openPaths]`)

`cacheRef`/`scrollRef`에서 `openPaths`에 없는 키를 삭제한다(닫힌 탭 정리, 무한 증가 방지). 전환 효과보다 **뒤에 선언**되어 같은 커밋에서 마지막에 실행되므로, 활성 탭 닫기 시 전환 효과가 남긴 닫힌-경로 항목까지 정리된다. set-difference이므로 새 활성 경로는 `openPaths`에 있어 삭제되지 않는다.

`openPaths`는 App에서 `useMemo(() => tabs.map(t => t.path), [tabs])`로 메모이즈해 전달한다. 인라인 `tabs.map(...)`은 매 렌더 새 배열을 만들어 이 효과를 불필요하게 매번 발화시키기 때문이다.

## 4. 데이터 흐름 / `docs` 맵

- 라이브 문서는 활성 뷰의 `view.state`, 비활성 탭은 캐시된 EditorState가 보유.
- `docs` 맵은 유지: 캐시 미스 시 `initialDoc` 공급, 리네임 마이그레이션, 리로드 복원(경로만). 저장(`onSave`)은 뷰에서 직접 문자열을 읽는다.
- 전환 시 `onPersist(prev, …)`로 `docs[prev]`를 동기화(현 동작 보존). 타이핑 중 `docs[active]`가 stale한 점은 현재와 동일(저장은 뷰 기준).

## 5. 동작 정합 노트

- **setState는 dirty를 잘못 표시하지 않음**: 프로그램적 `setState`는 `ViewUpdate`를 만들지 않아 `docChanged`/updateListener가 발화하지 않는다(C2). 별도 가드 불필요. 단, 문서 교체를 transaction(dispatch)로 하지 말 것(그건 docChanged 발화).
- **포커스(I4)**: `setState`는 직전에 에디터가 포커스였을 때만 포커스를 유지한다. 검색 패널 주도 전환은 포커스가 입력창에 있어 에디터로 넘어가지 않으므로 의도(검색 중 화살표 탐색 유지)와 일치한다. 회귀 없음.
- **리네임**: 경로 키가 바뀌어 옛 키는 evict되고, 새 경로는 캐시 미스로 `docs[to]`(App이 이미 마이그레이션)에서 재생성된다 → 리네임된 파일의 undo 히스토리는 초기화. 드문 동작이라 허용.

## 6. 변경 범위

- `src/App.tsx`: `key` 제거, `activePath`/`openPaths` 전달. (cursor/handlers는 이전 작업에서 이미 정리됨)
- `src/components/EditorPane.tsx`: 마운트-1회 구조로 재작성 — 단일 뷰, 전환/ reveal/ evict 효과, `cacheRef`/`scrollRef`/`currentPathRef`/`propsRef`, `Compartment` 제거.
- `src/lib/editorState.ts`(신설, 선택): `buildState`와 확장 집합을 순수 함수로 추출해 EditorPane 응집도 유지 + 단위 테스트 용이.

## 7. 테스트 / 검증

- **단위**: 추출한 `buildState`(언어별 확장 생성), 캐시 evict 로직(순수 헬퍼로 빼면 Map set-difference 검증 가능).
- **컴포넌트(RTL)**: 테스트 모델이 "파일마다 remount"에서 "`activePath` prop 교체로 전환"으로 바뀐다. 가능 범위에서 검증:
  - 같은 EditorView 인스턴스가 전환 후에도 유지되는지(remount 안 됨).
  - 전환 시 `onPersist(prev)`·`onCursorChange`가 호출되는지(목 콜백).
  - 캐시된 경로 재방문 시 새 state를 빌드하지 않는지.
- **jsdom 한계**: 실제 스크롤/`scrollIntoView`/포커스/파싱 성능은 jsdom에서 충실히 검증 불가 → `tauri dev` 수동 검증: ①전환 즉시성(특히 큰 파일 재방문) ②undo/커서/스크롤 보존 ③검색 reveal 위치 정확 ④타이핑 중 상태바 커서 갱신.
- 기존 테스트(현재 113개) 그린 유지.

## 8. 엣지 / 에러

- **최초 렌더 이중 발화**(C3): 마운트 효과에서 `currentPathRef`를 초기화·캐시 시드하므로 전환 효과의 첫 실행은 `prev === activePath`로 no-op.
- **아직 안 열린 파일 열기**: `openFile`이 `await readFile` 후 `setDocs`+`openTab` → activePath 변경 시점에 `docs[activePath]`(=`initialDoc`)가 채워져 있음. 검색 reveal은 `await openFile` 이후 set되므로 전환(문서 로드)이 reveal보다 앞선다.
- **활성 탭 닫기**: 전환 효과 save-outgoing은 `prev`가 openPaths에 있을 때만 → 닫힌 경로 재캐시 안 함. evict 효과가 뒤에서 정리.
- **모든 탭 닫힘**: EditorPane 언마운트 → 뷰·캐시 소실(허용). 다시 파일 열면 새로 마운트.
- **큰 파일**: 처음 열 때 Lezer 파싱은 불가피(현재와 동일), 재방문은 즉시.

## 9. 범위 밖 (Non-Goals)

- EditorState의 디스크/localStorage 영속화(재시작 후 복원).
- 스크롤을 픽셀 단위로 완벽 복원(measure 타이밍상 근사; 필요 시 선택 head로 `scrollIntoView` 대체 가능).
- 다중 뷰 풀링(Approach C), 외부 스토어 캐시(Approach B).
- 리네임 시 undo 히스토리 이관.
