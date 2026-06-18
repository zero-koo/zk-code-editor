# 키보드 단축키 설계 문서

- 작성일: 2026-06-18
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: zk-code-editor MVP + 다크 리디자인 + 전역 검색 완료

## 1. 개요

뷰 전환 단축키와, 등록된 단축키를 보여주는 읽기 전용 참고 화면을 추가한다.

- `Cmd/Ctrl + Shift + E` → Explorer 뷰
- `Cmd/Ctrl + Shift + F` → Search 뷰
- `Cmd/Ctrl + /` → 단축키 보기 모달 토글
- 단축키 모달은 위 단축키 **또는** ActivityBar 하단 버튼으로 열 수 있다.
- 에디터(CodeMirror)에 포커스가 있어도 단축키가 동작해야 한다.

## 2. 아키텍처

### 2.1 중앙 레지스트리 — `src/lib/shortcuts.ts` (단일 소스, 데이터 + 순수 헬퍼)

```ts
export interface KeyCombo {
  mod?: boolean;   // ⌘ on mac, Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
  key: string;     // e.key 값(문자는 소문자). 예: "e", "f", "/", "s"
}
export interface Shortcut {
  id: string;          // 예: "view.explorer"
  label: string;       // 예: "Show Explorer"
  group: string;       // 예: "View" | "File" | "Help"
  combo: KeyCombo;
  displayOnly?: boolean; // true면 전역 핸들러를 거치지 않음(다른 곳에서 처리, 표시만)
}

export const SHORTCUTS: Shortcut[] = [
  { id: "view.explorer", label: "Show Explorer", group: "View", combo: { mod: true, shift: true, key: "e" } },
  { id: "view.search",   label: "Show Search",   group: "View", combo: { mod: true, shift: true, key: "f" } },
  // 저장은 CodeMirror의 Mod-s 키맵이 처리한다(EditorPane). 여기선 표시 전용.
  { id: "file.save",     label: "Save",          group: "File", combo: { mod: true, key: "s" }, displayOnly: true },
  { id: "help.shortcuts",label: "Keyboard Shortcuts", group: "Help", combo: { mod: true, key: "/" } },
];

export const isMac: boolean; // 런타임 1회: navigator.platform/userAgent 기반
export function matchKeyEvent(e: KeyboardEvent, combo: KeyCombo, isMac: boolean): boolean;
export function formatCombo(combo: KeyCombo, isMac: boolean): string[]; // kbd 토큰 배열
```

**`matchKeyEvent` 계약 (정확 매칭 — 리뷰 I2/I4b):** 네 모디파이어를 모두 정확히 비교한다.
- `mod` 매핑: mac이면 `e.metaKey === true && e.ctrlKey === false`; 그 외 `e.ctrlKey === true && e.metaKey === false`. `combo.mod`가 false/undefined면 해당 키들이 눌리지 않아야 함(mac: `!metaKey`).
- `shift` 미지정 → `e.shiftKey === false`. `alt` 미지정 → `e.altKey === false`.
- 키 비교: `e.key.toLowerCase() === combo.key.toLowerCase()`.
- 따라서 `⌘⇧E`는 `meta && shift && !ctrl && !alt && key==="e"`에서만 발동. `⌘⇧⌥E`나 `⌘⇧⌃E`는 매치 안 됨.

**키 표기 규약 (리뷰 I3):** `combo.key`는 `e.key` 값(문자는 소문자). 글자 키는 Shift 동반 시에도 `e.key.toLowerCase()`로 비교하므로 안전. `/`는 US 레이아웃 기준 `e.key === "/"`. 비-US 레이아웃에서 `/`가 다른 키일 수 있는 점은 알려진 한계로 둔다(개인용 MVP).

**`formatCombo`:** mac이면 `["⌘","⇧","E"]` / 그 외 `["Ctrl","Shift","E"]` 식 토큰 배열. `/`는 `"/"`, 글자는 대문자로 표시.

### 2.2 전역 핸들러 — `src/hooks/useGlobalShortcuts.ts`

`useGlobalShortcuts(handlers: Record<string, () => void>)`:
- `window`에 keydown 리스너를 **capture 단계(`{ capture: true }`)로** 등록한다 (리뷰 C1/I1).
- 이벤트를 `SHORTCUTS` 중 **핸들러가 있는(=`displayOnly`가 아닌)** 항목과 `matchKeyEvent`로 매칭.
- 매치 시: `e.preventDefault()` + `e.stopPropagation()` 후 `handlers[id]()` 실행.
  - capture 단계 + stopPropagation이라 CodeMirror의 content-DOM keydown(bubble)까지 도달하지 않음 → `⌘/`의 `toggleComment`(defaultKeymap에 존재) 같은 충돌을 차단.
- 정리: 언마운트/handlers 변경 시 리스너 제거.

### 2.3 App 핸들러 맵

```ts
useGlobalShortcuts({
  "view.explorer": () => activate("explorer"),
  "view.search":   () => activate("search"),
  "help.shortcuts":() => setShortcutsOpen((o) => !o),
});
```
`file.save`는 핸들러 없음(`displayOnly`, CodeMirror가 처리).

## 3. UI

### 3.1 ShortcutsModal — `src/components/ShortcutsModal.tsx`
- props: `{ open: boolean; onClose: () => void }`. `open === false`면 아무것도 렌더 안 함.
- 중앙 모달 + 어두운 배경. 헤더(아이콘/제목 "Keyboard Shortcuts"/× 버튼) + 필터 입력 + 그룹별 목록.
- `SHORTCUTS`를 `group`으로 묶어 렌더(그룹 순서: 정의 순서 유지). 각 행: `label` + `formatCombo(combo, isMac)` 결과를 `kbd` 칩으로.
- **필터**: 입력값으로 `label`(부분일치, 대소문자 무시) 또는 키 토큰 매칭해 항목 필터.
- **닫기**: 배경 클릭 / × 버튼 / Esc. Esc는 **모달 내부 리스너**가 처리하고 `stopPropagation`하며 `open`일 때만 동작(전역 레지스트리를 거치지 않음 — 리뷰 I6).
- **포커스 (리뷰 M3)**: 열릴 때 `document.activeElement`를 저장하고 필터 입력에 포커스; 닫힐 때 저장한 요소로 포커스 복원. (전체 focus trap은 비범위.)

### 3.2 ActivityBar 버튼
- 하단에 단축키 버튼 추가(`aria-label="Keyboard Shortcuts"`), 키보드 아이콘. 하단 고정을 위해 `mt-auto`(또는 flex 스페이서) 사용 (리뷰 M4). 클릭 시 모달 토글.

### 3.3 App 상태
- `const [shortcutsOpen, setShortcutsOpen] = useState(false);` → `<ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />`.

## 4. 데이터 흐름
키 입력 → window(capture) 리스너 → `matchKeyEvent`로 레지스트리 매칭 → ⌘⇧E/F는 `activate(view)`, ⌘/는 모달 토글(+ preventDefault/stopPropagation). 버튼 클릭도 동일 토글.

## 5. 엣지 / 알려진 한계
- **모디파이어 조합이라** Explorer/Search/Help 단축키는 입력창(SearchPanel `<input>`)에 포커스가 있어도 동작한다(의도된 정책 — "input 포커스 시 무시" 가드를 두지 않음, 리뷰 I5).
- **네이티브 `prompt()`/`confirm()`(FileTreeNode 이름변경/삭제, 닫기 확인)이 열려 있는 동안엔** JS 이벤트 루프가 멈춰 단축키가 동작하지 않는다 — 정상/허용 (리뷰 I4).
- `Cmd+S`(저장)와 `Esc`는 전역 훅을 거치지 않고 각각 CodeMirror / 모달이 처리한다. 표시용 `file.save` 라벨은 CM 키맵과 별도 소스이므로 드리프트 가능 — 레지스트리에 주석으로 명시 (리뷰 M1).

## 6. 테스트
- `shortcuts.ts`:
  - `matchKeyEvent` 진리표 — `⌘⇧E` 매치, 모디파이어 과다(`⌘⇧⌥E`)/부족 시 불일치, mac↔비mac `mod` 매핑, `⌘S`에 shift 동반 시 불일치.
  - `formatCombo` mac/비mac 토큰.
- `useGlobalShortcuts`: window에 `KeyboardEvent`(meta/shift/key 명시) 디스패치 → 해당 핸들러 호출 + `preventDefault` 확인. 매치 없는 키는 무시.
- **불변식 테스트 (리뷰 M2)**: 모든 `SHORTCUTS` 항목은 `displayOnly === true` XOR (App handlers에 id 존재) — App 테스트에서 handlers와 대조.
- `ShortcutsModal`: 그룹·조합 렌더, 필터 narrows, Esc/배경/× 닫기, 닫을 때 포커스 복원.
- `ActivityBar`: 단축키 버튼 추가(기존 Explorer/Search 테스트 갱신).
- App 통합: `⌘⇧E`/`⌘⇧F`로 `activeView` 전환, `⌘/`로 모달 오픈.
- **수동 검증 (리뷰 M5)**: jsdom은 CodeMirror 실제 키맵/네이티브 다이얼로그를 재현 못 함 → `⌘/`가 주석 토글 없이 모달만 여는지, 에디터 포커스 중 ⌘⇧E/F 동작을 `tauri dev`에서 직접 확인.

## 7. 범위 밖 (Non-Goals, MVP)
- 단축키 재설정(remap) / 영속화
- 충돌 감지
- 멀티 코드(`⌘K ⌘S` 식)
- 전체 focus trap
- 비-US 키보드 레이아웃의 `/` 정밀 처리
