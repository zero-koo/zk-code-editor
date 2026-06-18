import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionLabel } from "./SectionLabel";

describe("SectionLabel", () => {
  it("renders its text with the shared label styling", () => {
    render(<SectionLabel>Explorer</SectionLabel>);
    const el = screen.getByText("Explorer");
    expect(el.className).toContain("uppercase");
    expect(el.className).toContain("text-tx-3");
  });
});
