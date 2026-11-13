import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { PromptOmnibox } from "./TaskContextFields";

function Harness({
  label,
  onPaths,
  onSkills,
}: {
  label: string;
  onPaths?: (v: string[]) => void;
  onSkills?: (v: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const id = label === "skills" ? "omnibox-skill" : "omnibox-prompt";
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <label htmlFor={id}>{label}</label>
      <PromptOmnibox
        id={id}
        value={value}
        onChange={setValue}
        workspace="/Users/dev/app"
        paths={[]}
        onPathsChange={onPaths ?? (() => {})}
        skills={[]}
        onSkillsChange={onSkills ?? (() => {})}
        inputRef={inputRef}
      />
    </QueryClientProvider>
  );
}

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/workspaces/files")) {
      return new Response(
        JSON.stringify({
          path: "/Users/dev/app",
          files: [
            { path: "src/TaskDialog.tsx", basename: "TaskDialog.tsx", directory: "src", score: 90 },
            { path: "src/TaskCard.tsx", basename: "TaskCard.tsx", directory: "src", score: 80 },
          ],
          local: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/skills")) {
      return new Response(JSON.stringify({ skills: [{ name: "frontend-design", linked: true, source: "symlink" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("@ omnibox detects the token from the live DOM value after a change event", async () => {
  mockFetch();
  const onPaths = vi.fn();
  render(<Harness label="prompt" onPaths={onPaths} />);

  const box = screen.getByLabelText("prompt") as HTMLTextAreaElement;
  // A single change event is the regression: sync() runs in a rAF and must not
  // read a stale render value, otherwise no suggestions ever appear.
  fireEvent.change(box, { target: { value: "Fix @Ta" } });
  box.setSelectionRange(7, 7);

  expect(await screen.findByRole("option", { name: /src\/TaskDialog.tsx/i })).toBeTruthy();
  expect(screen.getByRole("listbox", { name: /Workspace file suggestions/i })).toBeTruthy();

  fireEvent.keyDown(box, { key: "Enter" });
  expect(onPaths).toHaveBeenCalledWith(["src/TaskDialog.tsx"]);
});

test("$ omnibox offers linked skills and inserts the chosen one", async () => {
  mockFetch();
  const onSkills = vi.fn();
  render(<Harness label="skills" onSkills={onSkills} />);

  const box = screen.getByLabelText("skills") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "Use $front" } });
  box.setSelectionRange(11, 11);

  expect(await screen.findByRole("option", { name: /frontend-design/i })).toBeTruthy();
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSkills).toHaveBeenCalledWith(["frontend-design"]);
});
