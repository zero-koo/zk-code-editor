import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
  it("renders a left line-number gutter for each line", () => {
    const { container } = render(
      <EditorPane
        path="/p/multi.ts"
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
        path="/p/a.ts"
        languageId="typescript"
        initialDoc="const x = 1;"
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    // Syntax highlighting splits the line into token <span>s, so the document
    // text lives across multiple nodes inside .cm-line. Assert on the line's
    // full text content to verify the document was rendered into the editor.
    const line = container.querySelector(".cm-line") as HTMLElement;
    expect(line).toBeInTheDocument();
    expect(line.textContent).toMatch(/const x = 1;/);
  });

  it("calls onChange when the document is edited", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <EditorPane
        path="/p/a.ts"
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
        path="/p/a.ts"
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    // reveal line 2, match offsets 5..8 ("two")
    rerender(
      <EditorPane
        path="/p/a.ts"
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
        path="/p/a.ts"
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
});
