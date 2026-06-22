import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; @tanstack/react-virtual constructs one. A no-op
// stub lets the virtualizer initialize (it falls back to getBoundingClientRect
// for sizing, which is enough for tests). The real webview has ResizeObserver.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
}

// jsdom reports a zero-sized layout (offsetWidth/Height = 0), so
// @tanstack/react-virtual — which measures the scroll element via offsetHeight —
// sees a 0-height viewport and renders no rows. Report a fixed non-zero size for
// the scroll containers (`.zk-scroll`) only, leaving everything else (e.g.
// CodeMirror, which breaks if fed fake geometry) untouched. The real webview
// measures real geometry.
if (typeof HTMLElement !== "undefined") {
  for (const [prop, size] of [
    ["offsetHeight", 800],
    ["offsetWidth", 300],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList?.contains("zk-scroll")) return size;
        return original?.get?.call(this) ?? 0;
      },
    });
  }
}

// Node 26 ships an experimental global `localStorage` that is unusable without
// --localstorage-file and shadows jsdom's. Provide a deterministic in-memory
// implementation for tests (the real webview has a working localStorage).
{
  let store: Record<string, string> = {};
  const mock: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: mock,
  });
}
