import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
  it("renders a left line-number gutter for each line", () => {
    const { container } = render(
      <EditorPane
        activePath="/p/multi.ts"
        openPaths={["/p/multi.ts"]}
        languageId="typescript"
        initialDoc={"first\nsecond\nthird"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const gutter = container.querySelector(".cm-lineNumbers");
    expect(gutter).not.toBeNull();
    const numbers = Array.from(gutter!.querySelectorAll(".cm-gutterElement")).map(
      (el) => el.textContent
    );
    expect(numbers).toContain("1");
    expect(numbers).toContain("2");
    expect(numbers).toContain("3");
  });

  it("renders the document text into the editor", () => {
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc="const x = 1;"
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const line = container.querySelector(".cm-line") as HTMLElement;
    expect(line).toBeInTheDocument();
    expect(line.textContent).toMatch(/const x = 1;/);
  });

  it("calls onChange when the document is edited", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc=""
        onChange={onChange}
        onSave={() => {}}
      />
    );
    const editable = container.querySelector(".cm-content") as HTMLElement;
    editable.focus();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(editable, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("reveals a match: selects the range and is clamped to the doc", async () => {
    const { container, rerender } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    rerender(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
        reveal={{ line: 2, matchStart: 5, matchEnd: 8, seq: 1 }}
      />
    );
    const sel = view.state.selection.main;
    const line2 = view.state.doc.line(2);
    expect(sel.from).toBe(line2.from + 5);
    expect(sel.to).toBe(line2.from + 8);
  });

  it("calls onPersist with the current doc when unmounted", async () => {
    const onPersist = vi.fn();
    const { unmount, container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc="start"
        onChange={() => {}}
        onSave={() => {}}
        onPersist={onPersist}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    view.dispatch({ changes: { from: 5, insert: "X" } }); // "startX"
    unmount();
    expect(onPersist).toHaveBeenCalledWith("/p/a.ts", "startX");
  });

  it("reports the cursor on mount and on selection change", async () => {
    const onCursorChange = vi.fn();
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc={"abc\ndef"}
        onChange={() => {}}
        onSave={() => {}}
        onCursorChange={onCursorChange}
      />
    );
    expect(onCursorChange).toHaveBeenCalled(); // initial report
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    onCursorChange.mockClear();
    view.dispatch({ selection: { anchor: 5 } }); // offset 5 → line 2 of "abc\ndef"
    expect(onCursorChange).toHaveBeenCalledWith(expect.objectContaining({ line: 2 }));
  });

  // --- persistent-view behavior (new) ---

  it("keeps the same EditorView DOM across a file switch (no remount)", () => {
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
    };
    const { container, rerender } = render(<EditorPane {...props} />);
    const before = container.querySelector(".cm-editor");
    expect(before).not.toBeNull();
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    const after = container.querySelector(".cm-editor");
    expect(after).toBe(before); // same node → view was not destroyed/recreated
  });

  it("swaps the document content on a file switch", async () => {
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
    };
    const { container, rerender } = render(<EditorPane {...props} />);
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    expect(view.state.doc.toString()).toBe("beta");
  });

  it("persists the outgoing doc and reports the cursor on switch", () => {
    const onPersist = vi.fn();
    const onCursorChange = vi.fn();
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
      onPersist,
      onCursorChange,
    };
    const { rerender } = render(<EditorPane {...props} />);
    onCursorChange.mockClear();
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    expect(onPersist).toHaveBeenCalledWith("/a.ts", "alpha");
    expect(onCursorChange).toHaveBeenCalled(); // setState does not fire it; we report explicitly
  });
});
