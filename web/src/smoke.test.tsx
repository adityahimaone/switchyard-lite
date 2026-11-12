import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiffView } from "./Review";
import { Dag, layers } from "./Screens";
import { Login } from "./Login";
import { normalizeModels } from "./api";

test("diff view renders lines", () => {
  render(<DiffView text={"@@ -1 +1 @@\n-a\n+b"} />);
  expect(screen.getByLabelText("diff").textContent).toContain("+b");
});
test("layers orders dag by dependency", () => {
  const l = layers([{ id: "b", status: "todo", depends_on: ["a"] }, { id: "a", status: "done" }]);
  expect(l.map((c) => c[0].id)).toEqual(["a", "b"]);
  render(<Dag stages={[{ id: "a", name: "A", status: "running" }]} />);
  expect(screen.getByText("running")).toBeTruthy();
});
test("models normalize", () => {
  expect(normalizeModels(["x"])).toEqual([{ id: "x", name: "x" }]);
  expect(normalizeModels({ models: [{ id: "m", name: "M" }] })[0].name).toBe("M");
});
test("login shows disabled message when 404", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  render(<QueryClientProvider client={new QueryClient()}><Login onDone={() => {}} /></QueryClientProvider>);
  expect(await screen.findByText(/Password login is disabled/)).toBeTruthy();
});
