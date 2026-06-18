import { describe, it, expect, beforeEach } from "vitest";
import {
  saveWorkspaceRoot,
  loadWorkspaceRoot,
  saveOpenTabs,
  loadOpenTabs,
} from "./workspacePersistence";

describe("workspace persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a root path", () => {
    expect(loadWorkspaceRoot()).toBeNull();
    saveWorkspaceRoot("/proj");
    expect(loadWorkspaceRoot()).toBe("/proj");
  });

  it("clears the root when given null", () => {
    saveWorkspaceRoot("/proj");
    saveWorkspaceRoot(null);
    expect(loadWorkspaceRoot()).toBeNull();
  });
});

describe("open tabs persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the open tab session", () => {
    expect(loadOpenTabs()).toBeNull();
    saveOpenTabs({ root: "/proj", paths: ["/proj/a.ts", "/proj/b.ts"], activePath: "/proj/b.ts" });
    expect(loadOpenTabs()).toEqual({
      root: "/proj",
      paths: ["/proj/a.ts", "/proj/b.ts"],
      activePath: "/proj/b.ts",
    });
  });

  it("returns null when nothing is stored or it is malformed", () => {
    expect(loadOpenTabs()).toBeNull();
    localStorage.setItem("zk.openTabs", "{not json");
    expect(loadOpenTabs()).toBeNull();
  });
});
