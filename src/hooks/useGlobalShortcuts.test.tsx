import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

function Harness({ handlers }: { handlers: Record<string, () => void> }) {
  useGlobalShortcuts(handlers);
  return null;
}

describe("useGlobalShortcuts", () => {
  it("runs the matching handler and prevents default", () => {
    const onSearch = vi.fn();
    render(<Harness handlers={{ "view.search": onSearch }} />);
    // jsdom: isMac is false → Ctrl+Shift+F matches view.search
    const e = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores keys with no registered handler", () => {
    const onSearch = vi.fn();
    render(<Harness handlers={{ "view.search": onSearch }} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not fire display-only shortcuts (save) even if matched", () => {
    const onSave = vi.fn();
    render(<Harness handlers={{ "file.save": onSave }} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
