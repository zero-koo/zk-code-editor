import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { gitFileAction } from "./git";

describe("gitFileAction", () => {
  beforeEach(() => invoke.mockReset());

  it("invokes git_file_action with root, path, and action", async () => {
    invoke.mockResolvedValue(undefined);
    await gitFileAction("/repo", "src/a.ts", "stage");
    expect(invoke).toHaveBeenCalledWith("git_file_action", {
      root: "/repo",
      path: "src/a.ts",
      action: "stage",
    });
  });
});
