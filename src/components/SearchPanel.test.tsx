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
});
