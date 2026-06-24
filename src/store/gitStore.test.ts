import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitChanges } from "../api/types";

const gitChanges = vi.fn();
vi.mock("../api/git", () => ({ gitChanges: (...a: unknown[]) => gitChanges(...a) }));

import { useGitStore } from "./gitStore";

const empty: GitChanges = { is_repo: true, branch: "main", staged: [], unstaged: [] };

describe("gitStore", () => {
  beforeEach(() => {
    gitChanges.mockReset();
    useGitStore.setState({ changes: null, loadedRoot: null, loading: false, error: null });
  });

  it("loads changes and clears loading", async () => {
    gitChanges.mockResolvedValue(empty);
    await useGitStore.getState().load("/repo");
    expect(gitChanges).toHaveBeenCalledWith("/repo");
    expect(useGitStore.getState().changes).toEqual(empty);
    expect(useGitStore.getState().loading).toBe(false);
    expect(useGitStore.getState().error).toBeNull();
  });

  it("records the loaded root alongside changes", async () => {
    gitChanges.mockResolvedValue(empty);
    await useGitStore.getState().load("/repo");
    expect(useGitStore.getState().loadedRoot).toBe("/repo");
  });

  it("records an error message on failure", async () => {
    gitChanges.mockRejectedValue({ message: "git boom" });
    await useGitStore.getState().load("/repo");
    expect(useGitStore.getState().error).toBe("git boom");
    expect(useGitStore.getState().loading).toBe(false);
  });
});
