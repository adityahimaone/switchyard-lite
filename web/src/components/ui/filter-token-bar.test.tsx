import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { FilterBar, type Filter, type FilterFieldDef } from "./filter-token-bar";

const fields: FilterFieldDef[] = [
  {
    id: "status",
    label: "Status",
    operators: [
      { value: "is", label: "is" },
      { value: "is_any", label: "is any of", multi: true },
    ],
    options: [
      { value: "todo", label: "Todo", count: 2 },
      { value: "in_progress", label: "In progress", count: 1 },
    ],
  },
  {
    id: "executor",
    label: "Executor",
    operators: [{ value: "is", label: "is" }],
    options: [{ value: "claude", label: "claude", count: 3 }],
  },
];

function Harness({
  initial = [],
  onChange,
}: {
  initial?: Filter[];
  onChange?: (filters: Filter[]) => void;
}) {
  const [value, setValue] = useState<Filter[]>(initial);
  return (
    <FilterBar
      fields={fields}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function openTrigger(el: HTMLElement) {
  fireEvent.pointerDown(el);
  fireEvent.click(el);
}

test("adds a filter and picks a value", async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);

  openTrigger(screen.getByRole("button", { name: /Add filter/i }));
  fireEvent.click(await screen.findByRole("option", { name: /^Status/ }));

  openTrigger(screen.getByLabelText(/^Value:/));
  fireEvent.click(await screen.findByRole("option", { name: /^Todo/ }));
  expect(onChange).toHaveBeenCalled();
  const last = onChange.mock.calls.at(-1)?.[0] as Filter[];
  expect(last).toHaveLength(1);
  expect(last[0]).toMatchObject({ field: "status", operator: "is", values: ["todo"] });
  expect(screen.getByText("Todo")).toBeTruthy();
});

test("multi-value operator keeps the picker open and toggles values", async () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={[{ id: "f1", field: "status", operator: "is_any", values: [] }]}
      onChange={onChange}
    />
  );

  openTrigger(screen.getByLabelText(/^Value:/));
  fireEvent.click(await screen.findByRole("option", { name: /^Todo/ }));
  fireEvent.click(await screen.findByRole("option", { name: /^In progress/ }));

  const last = onChange.mock.calls.at(-1)?.[0] as Filter[];
  expect(last[0].values).toEqual(["todo", "in_progress"]);
});

test("removes a filter token", () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={[{ id: "f1", field: "status", operator: "is", values: ["todo"] }]}
      onChange={onChange}
    />
  );
  fireEvent.click(screen.getByLabelText(/Remove Status filter/i));
  expect(onChange.mock.calls.at(-1)?.[0]).toEqual([]);
});
