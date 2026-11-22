import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterBar, type Filter, type FilterFieldDef } from "./filter-token-bar";

const fields: FilterFieldDef[] = [
  {
    id: "status",
    label: "Status",
    operators: [{ value: "is", label: "is", multi: true }],
    options: [
      { value: "todo", label: "Todo" },
      { value: "done", label: "Done" },
    ],
  },
  {
    id: "executor",
    label: "Executor",
    operators: [{ value: "is", label: "is" }],
    options: [{ value: "codex", label: "codex" }],
  },
];

function Harness() {
  const [value, setValue] = useState<Filter[]>([]);
  return <FilterBar fields={fields} value={value} onChange={setValue} />;
}

/**
 * The picker search input sits inside a 28px pill. The global unlayered
 * `input` rule used to give it its own 1px border, opaque background and
 * 32px height, which drew a second rounded box inside the pill and overflowed
 * it. `field-flat` now resets border, background, height and padding.
 */
describe("FilterBar picker search input", () => {
  it("is marked field-flat so the global input chrome does not leak in", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Add filter/i }));
    const input = await screen.findByPlaceholderText("Filter…");

    expect(input.className).toContain("field-flat");
    expect(input.className).toContain("h-full");
    expect(input.className).toContain("min-w-0");
    expect(input.className).not.toContain("bg-transparent");
  });

  it("wraps the search input in a 28px pill with a focus ring", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Add filter/i }));
    const input = await screen.findByPlaceholderText("Filter…");
    const pill = input.parentElement;

    expect(pill).toBeTruthy();
    expect(pill!.className).toContain("h-7");
    expect(pill!.className).toContain("focus-within:border-focus");
  });

  it("filters the option list while typing", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Add filter/i }));
    const input = await screen.findByPlaceholderText("Filter…");
    fireEvent.change(input, { target: { value: "exec" } });

    expect(screen.getByRole("option", { name: /Executor/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Status/ })).toBeNull();
  });
});
