import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
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
