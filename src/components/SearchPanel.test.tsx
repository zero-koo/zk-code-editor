import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";
import type { SearchResponse } from "../api/types";

const searchWorkspace = vi.fn();
vi.mock("../api/fs", () => ({ searchWorkspace: (...a: unknown[]) => searchWorkspace(...a) }));

const resp = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  files: [
    {
      path: "/proj/src/a.ts",
      rel_path: "src/a.ts",
      matches: [
        { line_number: 3, preview: "const useEffect = 1", highlight_ranges: [[6, 15]], match_start: 6, match_end: 15 },
      ],
    },
  ],
  total_matches: 1,
  truncated: false,
  regex_error: null,
  ...over,
});

const navResp = {
  files: [
    {
      path: "/proj/a.ts",
      rel_path: "a.ts",
      matches: [
        { line_number: 1, preview: "one", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 },
        { line_number: 2, preview: "two", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 },
      ],
    },
  ],
  total_matches: 2,
  truncated: false,
  regex_error: null,
};

describe("SearchPanel", () => {
  beforeEach(() => searchWorkspace.mockReset());

  it("focuses the input when the panel becomes active", () => {
    const { rerender } = render(<SearchPanel onOpenMatch={() => {}} active={false} />);
    expect(screen.getByPlaceholderText(/search/i)).not.toHaveFocus();
    rerender(<SearchPanel onOpenMatch={() => {}} active={true} />);
    expect(screen.getByPlaceholderText(/search/i)).toHaveFocus();
  });

  it("runs a debounced search and renders grouped results", async () => {
    searchWorkspace.mockResolvedValue(resp());
    render(<SearchPanel onOpenMatch={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "useEffect");
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(await screen.findByText("useEffect")).toBeInTheDocument(); // highlighted segment
    expect(searchWorkspace).toHaveBeenCalled();
  });

  it("calls onOpenMatch with path, line and match offsets when a match is clicked", async () => {
    searchWorkspace.mockResolvedValue(resp());
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "useEffect");
    await userEvent.click(await screen.findByText("useEffect"));
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/src/a.ts", 3, 6, 15);
  });

  it("shows an inline message for an invalid regex", async () => {
    searchWorkspace.mockResolvedValue(resp({ files: [], total_matches: 0, regex_error: "bad pattern" }));
    render(<SearchPanel onOpenMatch={() => {}} />);
    await userEvent.click(screen.getByLabelText(/use regular expression/i));
    await userEvent.type(screen.getByPlaceholderText(/search/i), "(");
    expect(await screen.findByText(/bad pattern/i)).toBeInTheDocument();
  });

  it("selects the first match on ArrowDown and opens it with Enter", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("one");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/a.ts", 1, 0, 3);
  });

  it("moves the selection down then up", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("two");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}"); // 0 → 1 → 0
    await userEvent.keyboard("{Enter}");
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/a.ts", 1, 0, 3);
  });

  it("marks the selected match with aria-selected", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    render(<SearchPanel onOpenMatch={() => {}} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("one");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain("one");
  });

  it("does nothing on arrows/Enter when there are no results", async () => {
    searchWorkspace.mockResolvedValue({ files: [], total_matches: 0, truncated: false, regex_error: null });
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText(/0 results/);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onOpenMatch).not.toHaveBeenCalled();
  });
});
