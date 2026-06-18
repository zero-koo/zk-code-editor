import { describe, it, expect, beforeEach } from "vitest";
import { saveWorkspaceRoot, loadWorkspaceRoot } from "./workspacePersistence";

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
