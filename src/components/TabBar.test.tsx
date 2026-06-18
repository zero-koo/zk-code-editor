import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "./TabBar";
import type { Tab } from "../api/types";

const tabs: Tab[] = [
  { path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false },
  { path: "/p/b.ts", name: "b.ts", languageId: "typescript", dirty: true },
];

describe("TabBar", () => {
  it("scrolls the active tab into view when the active tab changes", () => {
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView; provide a spy.
    Element.prototype.scrollIntoView = scrollSpy;
    const { rerender } = render(
      <TabBar tabs={tabs} activePath="/p/a.ts" onSelect={() => {}} onClose={() => {}} />
    );
    scrollSpy.mockClear();
    rerender(<TabBar tabs={tabs} activePath="/p/b.ts" onSelect={() => {}} onClose={() => {}} />);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("renders each tab name", () => {
    render(<TabBar tabs={tabs} activePath="/p/a.ts" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
  });

  it("shows a dirty indicator on modified tabs", () => {
    render(<TabBar tabs={tabs} activePath="/p/a.ts" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("dirty-/p/b.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("dirty-/p/a.ts")).not.toBeInTheDocument();
  });

  it("calls onSelect when a tab is clicked", async () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} activePath="/p/a.ts" onSelect={onSelect} onClose={() => {}} />);
    await userEvent.click(screen.getByText("b.ts"));
    expect(onSelect).toHaveBeenCalledWith("/p/b.ts");
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<TabBar tabs={tabs} activePath="/p/a.ts" onSelect={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close a.ts"));
    expect(onClose).toHaveBeenCalledWith("/p/a.ts");
  });
});
