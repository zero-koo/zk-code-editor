# 열린 탭 복원 (Restore Open Tabs) 설계 문서

- 작성일: 2026-06-18
- 상태: 설계 확정 (구현 계획 작성 전)
- 선행: 워크스페이스 루트 영속화(`workspacePersistence.ts`) 완료

## 1. 개요

리로드/재시작 후 마지막 세션의 **열린 탭과 활성 탭**을 복원한다. 워크스페이스 루트는 이미 복원되므로(FileExplorer), 그 위에 탭을 다시 연다.

- 저장: 열린 파일 **경로 목록 + 활성 탭 경로** (+ 검증용 `root`)
- 복원: 디스크에서 **깨끗하게 재오픈** (미저장 편집분은 복원하지 않음 — 범위 밖)
- 워크스페이스별 스코핑: 저장된 `root`가 현재 `root`와 일치할 때만 복원

## 2. 영속화 (`src/lib/workspacePersistence.ts` 확장)

기존 `saveWorkspaceRoot`/`loadWorkspaceRoot`(루트/트리 복원용)는 그대로 두고 추가한다:

```ts
export interface SavedTabs {
  root: string;
  paths: string[];
  activePath: string | null;
}

export function saveOpenTabs(value: SavedTabs): void; // localStorage["zk.openTabs"] = JSON
export function loadOpenTabs(): SavedTabs | null;       // parse; null on absent/parse error
```

- 키: `"zk.openTabs"`. JSON 직렬화. 읽기 실패(없음/파싱 오류)는 `null` 반환(try/catch).
- `root`를 함께 저장해 복원 시 현재 워크스페이스와 일치 검증.

## 3. 복원 → 저장 순서 (경쟁 조건 방지)

**중요**: root가 세팅되는 렌더에서 "저장 effect"가 "복원 effect"보다 먼저 실행되면, 아직 빈 `tabs`로 `saveOpenTabs(root, [], null)`이 호출돼 저장 세션이 **덮어써진다**(복원이 읽기 전에). 이를 막기 위해 **hydration 게이트**를 둔다: 복원이 끝나기 전에는 저장하지 않는다.

```ts
const hydratedRef = useRef(false);
const [hydrated, setHydrated] = useState(false);
```

### 3.1 복원 effect (저장 effect보다 먼저 선언)
워크스페이스 루트는 FileExplorer 마운트 시 복원된다(`await setWorkspaceRoot` → `setRoot`). App은 스토어 `root`가 세팅되면 **한 번만** 복원을 시도한다:
```ts
useEffect(() => {
  if (hydratedRef.current) return;
  if (!root) return;                 // 루트 복원 전이면 대기
  hydratedRef.current = true;
  const saved = loadOpenTabs();
  if (saved && saved.root === root && tabs.length === 0) {
    void restoreTabs(saved.paths, saved.activePath).finally(() => setHydrated(true));
  } else {
    setHydrated(true);               // 복원할 게 없으면 즉시 저장 활성화
  }
}, [root]);
```

복원 루틴:
```ts
async function restoreTabs(paths: string[], activePath: string | null) {
  for (const path of paths) {
    try {
      const content = await readFile(path);
      if (content.kind !== "text") continue;          // 바이너리/대용량 스킵
      setDocs((d) => ({ ...d, [path]: content.text }));
      openTab({ path, name: basename(path), languageId: languageIdForFile(path), dirty: false });
    } catch {
      // 없는 파일 등 → 스킵
    }
  }
  if (activePath && paths.includes(activePath)) setActive(activePath);
}
```
- 백엔드 root가 먼저 세팅된 뒤 `readFile`이 호출되므로 경로 검증(`resolve_in_workspace`) 통과.
- `openTab`이 각 탭을 활성으로 만들지만, 마지막에 저장된 `activePath`로 명시적 `setActive`. (활성 대상이 스킵됐으면 마지막 열린 탭이 활성으로 남음 — 허용.)

### 3.2 저장 effect (hydration 이후에만)
```ts
useEffect(() => {
  if (!hydrated) return;             // 복원 완료 전엔 저장 안 함 (빈 목록 덮어쓰기 방지)
  if (root) saveOpenTabs({ root, paths: tabs.map((t) => t.path), activePath: activeTabPath });
}, [hydrated, root, tabs, activeTabPath]);
```
- hydration 후 탭 열기/닫기/이름변경/활성 변경마다 자동 갱신.
- 새 폴더를 열면 `root`가 바뀌고 탭이 비므로 저장 내용도 새 워크스페이스 기준으로 일관되게 유지됨.
- `root`가 없을 때(워크스페이스 닫힘)는 저장하지 않음.

## 4. 엣지 / 에러 처리

- 저장 `root` ≠ 현재 `root` → 복원 안 함(다른 폴더 열림).
- 저장 세션 없음/파싱 오류 → 복원 안 함.
- 경로가 사라졌거나 바이너리/대용량 → 해당 탭만 스킵, 나머지는 정상 복원.
- 이미 탭이 열려 있는 상태(정상 사용 중)면 복원 로직은 no-op.
- 미저장 편집 내용은 복원하지 않음(리로드 시 본래 소실 — 명시적 범위 밖).

## 5. 테스트

- **영속화**(`workspacePersistence.test.ts`): `saveOpenTabs`/`loadOpenTabs` 라운드트립, 없을 때 `null`. (localStorage는 setup 폴리필 + 테스트마다 clear)
- **App 통합**(`App.test.tsx`):
  - 일치하는 세션(`root` 일치, 경로 2개, 활성 1개)이 있으면 마운트 시 해당 탭들이 재오픈되고 저장된 활성 탭이 선택됨 — 경로별 `readFile` 모킹.
  - 세션의 한 경로가 바이너리/없는 파일이면 그 탭만 스킵되고 나머지는 열림.
  - 저장 `root`가 현재 `root`와 다르면 복원하지 않음.
- **수동**: `tauri dev`로 폴더 열고 탭 몇 개 연 뒤 리로드 → 탭/활성 탭 복원 확인.

## 6. 범위 밖 (Non-Goals)

- 커서/스크롤 위치 복원
- 미저장 편집 내용 영속화
- 탭 순서 드래그/그룹/핀
- 다중 워크스페이스 세션 동시 보관(현재는 마지막 워크스페이스 하나)
