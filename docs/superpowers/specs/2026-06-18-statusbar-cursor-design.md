# 상태바 강화 — 커서 위치 (Ln/Col + 선택) 설계 문서

- 작성일: 2026-06-18
- 상태: 설계 확정 (구현 계획 작성 전)

## 1. 개요

상태바에 **커서 위치(Ln/Col)** 와 **선택 글자 수**를 표시한다. 현재 상태바는 경로 + 언어만 보여준다. 실제 CodeMirror 커서/선택 상태를 반영한다.

- `Ln {line}, Col {col}` (둘 다 1-based)
- 선택이 있으면 `({n} selected)` (선택된 글자 수 합)
- 기존 경로(좌측)·언어 라벨(우측 끝)은 유지

## 2. 아키텍처

커서 상태를 EditorPane → App → StatusBar로 **콜백**으로 전달한다(기존 `onChange`/`onSave`/`onPersist`와 동일한 패턴; 스토어 슬라이스는 불필요).

### 2.1 커서 정보 헬퍼 — `src/lib/cursorInfo.ts` (신규, 순수 함수)
```ts
import type { EditorState } from "@codemirror/state";

export interface CursorInfo {
  line: number;      // 1-based
  col: number;       // 1-based (head의 줄 내 오프셋 + 1)
  selection: number; // 선택된 글자 수 합(없으면 0)
}

export function cursorInfo(state: EditorState): CursorInfo {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const selection = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  return { line: line.number, col: head - line.from + 1, selection };
}
```
- `col`은 UTF-16 코드유닛 기준(에디터 좌표계와 동일). 탭은 1칸으로 계산(탭 인식 컬럼은 범위 밖).

### 2.2 EditorPane (`src/components/EditorPane.tsx`)
- prop `onCursorChange?: (info: CursorInfo) => void` 추가. `cbRef`에 포함해 최신 콜백 유지.
- 뷰 생성 직후 1회 `cbRef.current.onCursorChange?.(cursorInfo(view.state))` 호출(초기 위치 보고).
- 기존 `updateListener`에서 `u.docChanged || u.selectionSet`이면 `cursorInfo(u.state)` 보고.
- 다른 prop/로직(reveal, save keymap, 라인거터 등)은 변경 없음.

### 2.3 App (`src/App.tsx`)
- `const [cursor, setCursor] = useState<CursorInfo | null>(null);`
- `<EditorPane … onCursorChange={setCursor} />`
- StatusBar에 `cursor={activeTab ? cursor : null}` 전달(열린 파일 없으면 표시 안 함).

### 2.4 StatusBar (`src/components/StatusBar.tsx`)
- prop `cursor?: CursorInfo | null` 추가.
- 우측 영역에 `cursor`가 있으면 `Ln {line}, Col {col}` 표시, `cursor.selection > 0`이면 ` ({selection} selected)` 덧붙임. 그 옆(또는 뒤)에 기존 언어 라벨(accent 점 포함) 유지.
- `data-testid="statusbar"` 유지.

## 3. 데이터 흐름
편집/선택 변경 → CM `updateListener` → `cursorInfo` → `onCursorChange` → App `cursor` state → StatusBar 렌더. 탭 전환 시 새 EditorPane이 마운트되며 즉시 초기 커서를 보고하므로 표시가 갱신됨. 탭 전부 닫히면 `activeTab`이 null → StatusBar에 `cursor=null` 전달.

## 4. 엣지 / 에러
- 열린 파일 없음(`activeTab` null) → Ln/Col 미표시(언어 라벨도 자연히 없음).
- 멀티 커서: 위치는 main 커서 기준, 선택 수는 전체 범위 합.
- 선택 0 → "selected" 미표시.

## 5. 테스트
- `cursorInfo`(`src/lib/cursorInfo.test.ts`): 구성한 `EditorState`로
  - 첫 줄 커서 → `{line:1, col:1, selection:0}`
  - 여러 줄 문서에서 특정 오프셋 → 올바른 line/col
  - 선택 범위 → `selection` = 길이 합
- `StatusBar`(`StatusBar.test.tsx`): `cursor` 주면 `Ln 2, Col 5` 류 표기, `selection>0`이면 선택 수 표기, `cursor=null`이면 미표시. 기존 path/language 테스트 유지.
- `EditorPane`(`EditorPane.test.tsx`): 마운트 시 `onCursorChange` 1회 호출, 선택 변경 transaction 디스패치 시 갱신된 line/col 보고.
- 전체 스위트 + 빌드 그린.

## 6. 범위 밖 (Non-Goals)
- 탭 인식 컬럼(탭을 여러 칸으로 계산)
- 들여쓰기(Spaces/Tabs) · EOL(LF/CRLF) · 인코딩 필드
- 멀티커서 개수 상세 표기
- 클릭으로 줄 이동(Go to line) 같은 상호작용
