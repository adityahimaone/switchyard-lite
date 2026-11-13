import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { BranchField, PromptOmnibox } from "./TaskContextFields";

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

test("base branch picker renders branches resolved on a worker node", async () => {
  const onChange = vi.fn();
  const onRefresh = vi.fn();
  render(
    <BranchField
      workspace="D:\\xampp\\htdocs\\demo"
      isGit
      inspect={{
        path: "D:\\xampp\\htdocs\\demo",
        is_git: true,
        branches: ["main", "dev"],
        current: "main",
        local: false,
        source: "worker",
      }}
      value=""
      onChange={onChange}
      onRefresh={onRefresh}
    />
  );

  expect(screen.getByText(/worker · 2/i)).toBeTruthy();
  const trigger = screen.getByLabelText("Base branch");
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  const dev = await screen.findByRole("option", { name: /dev/i });
  fireEvent.click(dev);
  expect(onChange).toHaveBeenCalledWith("dev");

  fireEvent.click(screen.getByLabelText("Refresh branch list"));
  expect(onRefresh).toHaveBeenCalled();
});

test("base branch picker stays visible without a git repository", () => {
  render(
    <BranchField
      workspace="/tmp/scratch"
      isGit={false}
      inspect={{
        path: "/tmp/scratch",
        is_git: false,
        branches: [],
        local: true,
        source: "local",
        warning: "No git repository found in this workspace.",
      }}
      value=""
      onChange={() => {}}
    />
  );
  // The old implementation returned null here, which is why the field seemed
  // to disappear entirely for non-git workspaces.
  expect(screen.getByLabelText("Base branch")).toBeTruthy();
  expect(screen.getByText(/No git repository found/i)).toBeTruthy();
});

function MixedHarness({
  boardTasks,
  onPaths,
}: {
  boardTasks: Parameters<typeof PromptOmnibox>[0]["boardTasks"];
  onPaths: (v: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <label htmlFor="omni-mixed">mixed</label>
      <PromptOmnibox
        id="omni-mixed"
        value={value}
        onChange={setValue}
        workspace="/Users/dev/app"
        paths={[]}
        onPathsChange={onPaths}
        skills={[]}
        onSkillsChange={() => {}}
        boardTasks={boardTasks}
        inputRef={ref}
      />
    </QueryClientProvider>
  );
}

test("@ omnibox merges file, symbol and task-card suggestions", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/workspaces/files")) {
      return new Response(
        JSON.stringify({
          path: "/Users/dev/app",
          files: [{ path: "src/TaskDialog.tsx", basename: "TaskDialog.tsx", directory: "src", score: 90 }],
          local: false,
          source: "worker",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/workspaces/symbols")) {
      return new Response(
        JSON.stringify({
          symbols: [
            { name: "TaskDialogProps", kind: "symbol", file_path: "src/TaskDialog.tsx", line: 12 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const onPaths = vi.fn();
  const boardTasks = [
    { id: "t_1", board_id: "b", title: "Task dialog polish", prompt: "", status: "todo" as const, retry_count: 0, blocked_by: [], created_at: 0, updated_at: 0 },
  ];
  render(<MixedHarness boardTasks={boardTasks} onPaths={onPaths} />);

  const box = screen.getByLabelText("mixed") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "Fix @Task" } });
  box.setSelectionRange(9, 9);

  expect(await screen.findByRole("option", { name: /TaskDialogProps/i })).toBeTruthy();
  expect(await screen.findByRole("option", { name: /Task dialog polish/i })).toBeTruthy();
  expect(screen.getByRole("listbox", { name: /Workspace file suggestions/i })).toBeTruthy();
});
