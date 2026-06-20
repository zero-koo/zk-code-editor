import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useCursorStore } from "../store/cursorStore";

describe("StatusBar", () => {
  beforeEach(() => useCursorStore.setState({ cursor: null }));

  it("shows the active file path and language label", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" />);
    expect(screen.getByText("/p/a.ts")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("renders nothing meaningful when no file is open", () => {
    render(<StatusBar path={null} languageId={null} />);
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();
  });

  it("shows the cursor position from the store", () => {
    useCursorStore.setState({ cursor: { line: 2, col: 5, selection: 0 } });
    render(<StatusBar path="/p/a.ts" languageId="typescript" />);
    expect(screen.getByText(/Ln 2, Col 5/)).toBeInTheDocument();
  });

  it("shows the selection count when text is selected", () => {
    useCursorStore.setState({ cursor: { line: 1, col: 3, selection: 4 } });
    render(<StatusBar path="/p/a.ts" languageId="typescript" />);
    expect(screen.getByText(/4 selected/)).toBeInTheDocument();
  });

  it("omits cursor info when cursor is null", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" />);
    expect(screen.queryByText(/Ln /)).not.toBeInTheDocument();
  });

  it("omits cursor info when no file is open even if the store has a cursor", () => {
    useCursorStore.setState({ cursor: { line: 2, col: 5, selection: 0 } });
    render(<StatusBar path={null} languageId={null} />);
    expect(screen.queryByText(/Ln /)).not.toBeInTheDocument();
  });
});
