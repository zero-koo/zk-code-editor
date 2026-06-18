import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("renders an accessible button with its children and calls onClick", async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Close file" onClick={onClick}>
        <span data-testid="ico" />
      </IconButton>
    );
    const btn = screen.getByRole("button", { name: "Close file" });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId("ico")).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("merges custom className", () => {
    render(<IconButton label="x" onClick={() => {}} className="w-5 h-5"><i /></IconButton>);
    expect(screen.getByRole("button", { name: "x" }).className).toContain("w-5");
  });
});
