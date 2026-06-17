import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { readDir, readFile, writeFile } from "./fs";

describe("fs api", () => {
  beforeEach(() => invokeMock.mockReset());

  it("readDir forwards the path argument", async () => {
    invokeMock.mockResolvedValue([{ name: "a", path: "/x/a", is_dir: false }]);
    const result = await readDir("/x");
    expect(invokeMock).toHaveBeenCalledWith("read_dir", { path: "/x" });
    expect(result[0].name).toBe("a");
  });

  it("readFile returns the FileContent union", async () => {
    invokeMock.mockResolvedValue({ kind: "text", text: "hi" });
    const c = await readFile("/x/a.txt");
    expect(c).toEqual({ kind: "text", text: "hi" });
  });

  it("writeFile passes path and contents", async () => {
    invokeMock.mockResolvedValue(null);
    await writeFile("/x/a.txt", "data");
    expect(invokeMock).toHaveBeenCalledWith("write_file", {
      path: "/x/a.txt",
      contents: "data",
    });
  });

  it("searchWorkspace passes query and opts", async () => {
    invokeMock.mockResolvedValue({ files: [], total_matches: 0, truncated: false, regex_error: null });
    const { searchWorkspace } = await import("./fs");
    await searchWorkspace("foo", { case_sensitive: false, regex: false });
    expect(invokeMock).toHaveBeenCalledWith("search_workspace", {
      query: "foo",
      opts: { case_sensitive: false, regex: false },
    });
  });
});
