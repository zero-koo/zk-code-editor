import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FileIcon, CloseIcon } from "./icons";

describe("icons", () => {
  it("renders an svg at the given size and forwards stroke", () => {
    const { container } = render(<FileIcon size={14} stroke="#7aa2f7" />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    expect(svg.getAttribute("stroke")).toBe("#7aa2f7");
  });

  it("defaults stroke to currentColor and forwards className", () => {
    const { container } = render(<CloseIcon className="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("class")).toContain("x");
  });
});
