import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTreeNode } from "./FileTreeNode";

const readDir = vi.fn();
vi.mock("../api/fs", () => ({ readDir: (...a: unknown[]) => readDir(...a) }));

describe("FileTreeNode", () => {
  beforeEach(() => readDir.mockReset());

  it("renders a file entry's name", () => {
    render(
      <FileTreeNode
        entry={{ name: "a.ts", path: "/p/a.ts", is_dir: false }}
        depth={0}
        onOpenFile={() => {}}
      />
    );
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("calls onOpenFile when a file is clicked", async () => {
    const onOpenFile = vi.fn();
    render(
      <FileTreeNode
        entry={{ name: "a.ts", path: "/p/a.ts", is_dir: false }}
        depth={0}
        onOpenFile={onOpenFile}
      />
    );
    await userEvent.click(screen.getByText("a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("/p/a.ts");
  });

  it("expands a directory and lists its children on click", async () => {
    readDir.mockResolvedValue([{ name: "child.ts", path: "/p/dir/child.ts", is_dir: false }]);
    render(
      <FileTreeNode
        entry={{ name: "dir", path: "/p/dir", is_dir: true }}
        depth={0}
        onOpenFile={() => {}}
      />
    );
    await userEvent.click(screen.getByText("dir"));
    expect(await screen.findByText("child.ts")).toBeInTheDocument();
    expect(readDir).toHaveBeenCalledWith("/p/dir");
  });
});
