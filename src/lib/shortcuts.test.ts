import { describe, it, expect } from "vitest";
import { SHORTCUTS, matchKeyEvent, formatCombo } from "./shortcuts";

function kd(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchKeyEvent", () => {
  const combo = { mod: true, shift: true, key: "e" };
  it("matches Cmd+Shift+E on mac", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true }), combo, true)).toBe(true);
  });
  it("matches Ctrl+Shift+E off-mac", () => {
    expect(matchKeyEvent(kd({ key: "E", ctrlKey: true, shiftKey: true }), combo, false)).toBe(true);
  });
  it("does not match when an extra modifier is held", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true, altKey: true }), combo, true)).toBe(false);
  });
  it("does not match when the cross-platform modifier is held", () => {
    // on mac, ctrl must never be down for our combos
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true, ctrlKey: true }), combo, true)).toBe(false);
  });
  it("does not match a missing modifier", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true }), combo, true)).toBe(false); // no shift
  });
  it("save (Cmd+S) does not fire when Shift is held", () => {
    const save = { mod: true, key: "s" };
    expect(matchKeyEvent(kd({ key: "s", metaKey: true }), save, true)).toBe(true);
    expect(matchKeyEvent(kd({ key: "s", metaKey: true, shiftKey: true }), save, true)).toBe(false);
  });
});

describe("formatCombo", () => {
  it("uses mac symbols", () => {
    expect(formatCombo({ mod: true, shift: true, key: "e" }, true)).toEqual(["⌘", "⇧", "E"]);
  });
  it("uses PC labels", () => {
    expect(formatCombo({ mod: true, shift: true, key: "e" }, false)).toEqual(["Ctrl", "Shift", "E"]);
  });
  it("renders the slash key literally", () => {
    expect(formatCombo({ mod: true, key: "/" }, true)).toEqual(["⌘", "/"]);
  });
});

describe("SHORTCUTS registry", () => {
  it("contains the shortcuts with stable ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toEqual(["view.explorer", "view.search", "view.git", "file.save", "help.shortcuts"]);
  });
  it("marks save as displayOnly and the rest as actionable", () => {
    const actionable = SHORTCUTS.filter((s) => !s.displayOnly).map((s) => s.id);
    expect(actionable).toEqual(["view.explorer", "view.search", "view.git", "help.shortcuts"]);
  });
});
