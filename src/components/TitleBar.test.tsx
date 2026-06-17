import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";

describe("TitleBar", () => {
  it("shows the active file name", () => {
    render(<TitleBar title="EditorPane.tsx" />);
    expect(screen.getByText("EditorPane.tsx")).toBeInTheDocument();
  });

  it("falls back to the app name when no file is open", () => {
    render(<TitleBar title={null} />);
    expect(screen.getByText("zk-code-editor")).toBeInTheDocument();
  });
});
