import "@testing-library/jest-dom/vitest";

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
