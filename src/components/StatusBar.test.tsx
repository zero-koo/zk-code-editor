import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
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

  it("shows the cursor position", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={{ line: 2, col: 5, selection: 0 }} />);
    expect(screen.getByText(/Ln 2, Col 5/)).toBeInTheDocument();
  });

  it("shows the selection count when text is selected", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={{ line: 1, col: 3, selection: 4 }} />);
    expect(screen.getByText(/4 selected/)).toBeInTheDocument();
  });

  it("omits cursor info when cursor is null", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={null} />);
    expect(screen.queryByText(/Ln /)).not.toBeInTheDocument();
  });
});
