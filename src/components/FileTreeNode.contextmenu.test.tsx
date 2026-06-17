import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTreeNode } from "./FileTreeNode";

const readDir = vi.fn();
const deletePath = vi.fn();
const rename = vi.fn();
const createFile = vi.fn();
vi.mock("../api/fs", () => ({
  readDir: (...a: unknown[]) => readDir(...a),
  deletePath: (...a: unknown[]) => deletePath(...a),
  rename: (...a: unknown[]) => rename(...a),
  createFile: (...a: unknown[]) => createFile(...a),
}));

describe("FileTreeNode context menu", () => {
  beforeEach(() => [readDir, deletePath, rename, createFile].forEach((m) => m.mockReset()));

  it("deletes a file after confirmation and notifies parent", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deletePath.mockResolvedValue(undefined);
    const onFsChange = vi.fn();
    render(
      <FileTreeNode
        entry={{ name: "a.ts", path: "/p/a.ts", is_dir: false }}
        depth={0}
        onOpenFile={() => {}}
        onFsChange={onFsChange}
      />
    );
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("a.ts") });
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(deletePath).toHaveBeenCalledWith("/p/a.ts");
    expect(onFsChange).toHaveBeenCalledWith({ type: "delete", path: "/p/a.ts" });
  });
});
