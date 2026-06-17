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
});
