# 의뢰: zk-code-editor 비주얼 디자인 리뉴얼

## 역할
너는 데스크톱 코드 에디터의 UI/비주얼 디자이너 겸 프론트엔드 구현자다.
기존에 "동작은 완성됐지만 스타일이 기본 수준"인 앱을 모던 미니멀 방향으로 리디자인하고, Tailwind 기반으로 구현해줘.

## 제품 컨텍스트
- zk-code-editor: 개인이 매일 쓰는 경량 코드 에디터(IDE). Tauri v2 데스크톱 앱.
- 핵심 기능 4가지: 파일 탐색기 / 코드 편집 / 구문 강조 / 탭. (LSP·터미널·Git 패널은 의도적으로 없음 — 가벼움이 정체성)
- 원하는 톤: **모던 미니멀** — Linear, Raycast 같은 절제되고 세련된 느낌. 군더더기 없고, 여백과 위계가 분명하고, 인터랙션은 미묘하고 부드럽게.
- 에디터가 화면의 주인공이다. 크롬(주변 UI)은 조용하게 물러나고 코드가 돋보여야 한다.

## 기술 스택 / 제약
- React 18 + TypeScript + Vite.
- 스타일링: **Tailwind CSS 도입 예정** — Tailwind로 구현해줘. (현재는 단일 `src/App.css` 플레인 CSS. 이걸 Tailwind + 디자인 토큰 체계로 대체)
- 에디터: **CodeMirror 6** (현재 `@codemirror/theme-one-dark` 사용 중). 주변 UI 팔레트와 조화되는 **커스텀 CodeMirror 테마**(배경/거터/활성 라인/선택영역/구문 토큰 색)도 함께 설계·제공해줘. oneDark가 새 팔레트와 안 맞으면 교체 전제.
- 테마: **다크 우선.** 라이트 모드 지원 여부와 토큰 구조는 네가 제안해줘(다크만 완성도 높게 가도 되고, 토큰을 라이트 확장 가능하게 잡아도 됨).
- 데스크톱 단일 창. 커스텀 타이틀바(프레임리스)로 갈지 여부도 제안 가능(선택).
- 아이콘: 현재 이모지(📁 📄 🗂 ● ×) 사용 중. lucide-react 같은 적절한 아이콘 세트 도입을 권장 — 제안해줘.

## 현재 레이아웃 & 컴포넌트 구조 (이 표면들을 디자인 대상으로)
```
App (.app, flex 가로)
├─ ActivityBar (.activitybar)         — 좌측 세로 아이콘 바. Explorer 토글 버튼(aria-label="Explorer", aria-pressed)
├─ Sidebar (.sidebar)
│  └─ FileExplorer (.explorer)
│     ├─ .explorer-header             — "EXPLORER" 라벨 + "Open Folder" 버튼
│     └─ FileTreeNode (.tree-row, 재귀) — 폴더 펼침/접힘, 파일/폴더 아이콘, 들여쓰기(depth*12+8px)
│        └─ 우클릭 컨텍스트 메뉴 (.context-menu, role=menu / role=menuitem: New File·Rename·Delete)
├─ EditorArea (.editor-area)
│  ├─ TabBar (.tabbar, role=tablist)  — 탭들(role=tab). .tab.active, dirty 점(.dirty, ● ), 닫기 버튼(.tab-close, aria-label="Close <name>")
│  ├─ .notice                          — 에러/안내 배너 (예: "Cannot preview binary file…", "Failed to save…")
│  ├─ EditorPane (.editor-host)        — CodeMirror 마운트(.cm-editor)
│  │  └─ .empty                        — 열린 파일 없을 때 "No file open"
│  └─ StatusBar (.statusbar)           — 현재 파일 경로 + 언어 라벨
```

## 현재 스타일 (개선 대상 베이스라인)
```css
:root { color-scheme: dark; }
body { margin: 0; }
.app { display:flex; height:100vh; font-family:system-ui; background:#1e1e1e; color:#ccc; }
.activitybar { width:48px; background:#2c2c2c; display:flex; flex-direction:column; align-items:center; padding-top:8px; }
.activitybar button { background:none; border:none; font-size:20px; cursor:pointer; opacity:.6; }
.activitybar button.active { opacity:1; }
.sidebar { width:240px; background:#252526; overflow:auto; }
.explorer-header { display:flex; justify-content:space-between; padding:8px; }
.tree-row { cursor:pointer; padding:2px 0; white-space:nowrap; }
.tree-row:hover { background:#2a2d2e; }
.editor-area { flex:1; display:flex; flex-direction:column; min-width:0; }
.tabbar { display:flex; background:#2d2d2d; }
.tab { display:flex; align-items:center; gap:6px; padding:6px 10px; cursor:pointer; }
.tab.active { background:#1e1e1e; }
.tab-close { background:none; border:none; color:inherit; cursor:pointer; }
.dirty { color:#e0e0e0; }
.editor-host { flex:1; overflow:auto; }
.editor-host .cm-editor { height:100%; }
.statusbar { display:flex; gap:16px; padding:2px 10px; background:#007acc; color:#fff; font-size:12px; }
.notice { padding:8px; background:#3a3a00; color:#ffd; }
.empty { flex:1; display:flex; align-items:center; justify-content:center; opacity:.5; }
```

## 디자인 요구사항
1. **디자인 토큰 먼저** — 색(배경 레이어 2~3단계, 텍스트 1·2·3차, 액센트, 보더, 상태색), 타이포(UI 폰트 + 에디터용 모노스페이스), 간격 스케일, 라운드, 그림자, 모션(트랜지션) 토큰을 Tailwind theme(또는 CSS 변수)로 정의.
2. **상태를 빠짐없이** — 각 인터랙티브 요소의 default/hover/active/focus(키보드 포커스 링)/disabled/selected 상태. 특히: 파일트리 행(hover·선택·폴더 펼침), 탭(활성·비활성·hover·dirty·닫기 hover), 버튼들, 컨텍스트 메뉴 항목.
3. **에디터 테마** — CodeMirror 6 커스텀 테마: 에디터 배경, 거터(라인넘버), 활성 라인 하이라이트, 선택 영역, 커서, 그리고 구문 토큰 팔레트(키워드/문자열/주석/함수/숫자/타입 등). 주변 UI와 한 몸처럼.
4. **밀도** — 코드 도구다운 정보 밀도. 너무 헐겁지 않게, 그러나 답답하지 않게.
5. **스크롤바·미세 디테일** — 커스텀 스크롤바, 구분선, 빈 상태(.empty), 안내 배너(.notice)를 토스트/인라인 배너로 격상.
6. **접근성** — 텍스트 대비(WCAG AA), 키보드 포커스 가시성, 색에만 의존하지 않는 상태 표현(dirty 등).

## 반드시 지킬 것 (테스트 보호 — 매우 중요)
컴포넌트의 동작·구조·props는 바꾸지 말고 **시각만** 바꿔라. 다음 시맨틱 훅은 테스트(58개)가 의존하므로 **반드시 유지**:
- ARIA roles: `tablist`, `tab`, `tree`, `treeitem`, `menu`, `menuitem`
- aria-label 텍스트: `"Explorer"`, `"Close <파일명>"`, 버튼 텍스트 `"Open Folder"`, 메뉴 항목 텍스트 `"New File"/"Rename"/"Delete"`
- `data-testid="dirty-<path>"` (dirty 표시), `data-testid="statusbar"`
- 파일트리 행의 아이콘과 파일명은 **각각 별도 span**으로 유지(`tree-icon`/`tree-name` 또는 동등), 파일명은 자체 텍스트 노드로(정확한 텍스트 매칭 테스트 때문)
- 클래스명은 자유롭게 바꿔도 됨(테스트는 role/text/testid로 조회). Tailwind 클래스로 대체 OK.

## 산출물
1. 디자인 토큰 정의 (`tailwind.config` theme 확장 + 필요시 CSS 변수).
2. 컴포넌트별 리스타일 구현 (Tailwind className 적용). 동작/구조/시맨틱 훅 유지.
3. CodeMirror 6 커스텀 테마 모듈 (예: `src/lib/editorTheme.ts`) — `languageExtension`과 함께 EditorPane에 꽂을 수 있는 형태.
4. 다크(필수) / 라이트(제안 시) 토큰.
5. 주요 화면 목업 또는 적용 후 스크린샷, 그리고 상태(hover/active/dirty/focus) 커버 설명.
6. 적용 방법 요약(어떤 파일을 어떻게 바꿨는지).

## 참고 문서 (레포 접근 가능 시)
- 설계: docs/superpowers/specs/2026-06-17-zk-code-editor-design.md
- 구현 계획: docs/superpowers/plans/2026-06-17-zk-code-editor.md
- 스타일 진입점: src/App.css, 컴포넌트: src/components/*.tsx, 에디터: src/components/EditorPane.tsx
