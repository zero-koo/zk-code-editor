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

const twoFileResp = {
  files: [
    { path: "/proj/a.ts", rel_path: "a.ts", matches: [{ line_number: 1, preview: "aaa", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 }] },
    { path: "/proj/b.ts", rel_path: "b.ts", matches: [{ line_number: 2, preview: "bbb", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 }] },
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

  it("opens the match on arrow navigation (not only on Enter)", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("one");
    await userEvent.keyboard("{ArrowDown}"); // moves to + opens the first match
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/a.ts", 1, 0, 3);
  });

  it("clicking a match selects it so arrow nav continues from there", async () => {
    searchWorkspace.mockResolvedValue(navResp); // matches: "one" (line 1), "two" (line 2)
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, "x");
    await screen.findByText("one");
    await userEvent.click(screen.getByText("one")); // open + select index 0
    expect(onOpenMatch).toHaveBeenLastCalledWith("/proj/a.ts", 1, 0, 3);
    input.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}"); // 0 → 1 → opens "two"
    expect(onOpenMatch).toHaveBeenLastCalledWith("/proj/a.ts", 2, 0, 3);
  });

  it("skips a collapsed file's matches when navigating", async () => {
    searchWorkspace.mockResolvedValue(twoFileResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, "x");
    await screen.findByText("aaa");
    await userEvent.click(screen.getByText("a.ts")); // collapse the first file
    expect(screen.queryByText("aaa")).not.toBeInTheDocument();
    input.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}"); // first navigable match is now b.ts's
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/b.ts", 2, 0, 3);
  });

  it("resets the selection when a file is collapsed", async () => {
    searchWorkspace.mockResolvedValue(twoFileResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, "x");
    await screen.findByText("aaa");
    await userEvent.keyboard("{ArrowDown}"); // select the a.ts match (index 0) — also opens it
    await userEvent.click(screen.getByText("a.ts")); // collapse it → selection resets to -1
    onOpenMatch.mockClear();
    input.focus();
    await userEvent.keyboard("{Enter}"); // nothing selected → no open (would open if not reset)
    expect(onOpenMatch).not.toHaveBeenCalled();
  });
});
