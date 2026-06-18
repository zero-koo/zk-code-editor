import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarPanel } from "./SidebarPanel";

describe("SidebarPanel", () => {
  it("renders children inside the 258px sidebar shell", () => {
    const { container } = render(
      <SidebarPanel>
        <span>content</span>
      </SidebarPanel>
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-[258px]");
    expect(root.className).toContain("border-r");
  });
});
