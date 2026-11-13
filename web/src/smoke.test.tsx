import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiffView } from "./Review";
import { Dag, layers } from "./Screens";
import { Login } from "./Login";
import { BoardScreen } from "./Board";
import { TaskDrawer } from "./Drawer";
import { WorkspacesPage } from "@/components/workspaces/WorkspacesPage";
import { TaskDetailPage } from "@/components/board/TaskDetailPage";
import { normalizeModels } from "./api";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
test("board screen allows switching between multiple boards", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/boards")) {
      return new Response(
        JSON.stringify([
          { id: "b_alpha", name: "Alpha Board" },
          { id: "b_beta", name: "Beta Board" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/boards/b_alpha/tasks")) {
      return new Response(
        JSON.stringify([{ id: "t_1", board_id: "b_alpha", title: "Alpha Task", prompt: "", status: "todo", retry_count: 0, blocked_by: [], created_at: 1, updated_at: 1 }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/boards/b_beta/tasks")) {
      return new Response(
        JSON.stringify([{ id: "t_2", board_id: "b_beta", title: "Beta Task", prompt: "", status: "todo", retry_count: 0, blocked_by: [], created_at: 1, updated_at: 1 }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Alpha Task")).toBeTruthy();
  const switcher = screen.getByLabelText("Switch board") as HTMLSelectElement;
  fireEvent.change(switcher, { target: { value: "b_beta" } });
  expect(await screen.findByText("Beta Task")).toBeTruthy();
});

test("new task button opens shadcn modal dialog and creates task", async () => {
  localStorage.clear();
  let createdBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/v1/boards")) {
      return new Response(JSON.stringify([{ id: "b_1", name: "Main Board", default_executor: "claude" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/boards/b_1/tasks")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/tasks") && method === "POST") {
      createdBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({ id: "t_new", board_id: "b_1", title: createdBody?.title, status: "todo" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  const btn = await screen.findByRole("button", { name: "New task" });
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);

  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship shadcn task modal" } });
  fireEvent.click(screen.getByRole("button", { name: /Create task/i }));

  await waitFor(() => expect(createdBody).not.toBeNull());
  expect(createdBody).toMatchObject({
    board_id: "b_1",
    title: "Ship shadcn task modal",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("workspaces page groups workspaces by Mac, Windows, and Current machine", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/workspaces")) {
      return new Response(
        JSON.stringify([
          { id: "ws_cur", name: "Local Repo", path: "/srv/repo", os: "linux", kind: "current", status: "online" },
          { id: "ws_mac", name: "MacBook Pro", path: "/Users/dev/app", host: "dev@macbook.local", os: "darwin", kind: "ssh", status: "online" },
          { id: "ws_win", name: "WinBox", path: "C:\\src\\winapp", host: "dev@winbox", os: "windows", kind: "ssh", status: "offline" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspacesPage />
    </QueryClientProvider>
  );

  expect(await screen.findByText("MacBook Pro")).toBeTruthy();
  expect(screen.getByText("WinBox")).toBeTruthy();
  expect(screen.getByText("Local Repo")).toBeTruthy();
  expect(screen.getByText("macOS")).toBeTruthy();
  expect(screen.getByText("Windows")).toBeTruthy();
  expect(screen.getByText("Current machine")).toBeTruthy();
});

test("task drawer and full detail page render all 4 detail tabs", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/tasks/t_42")) {
      return new Response(
        JSON.stringify({
          id: "t_42",
          board_id: "b_1",
          title: "Implement 1:1 Task Detail",
          prompt: "Verify drawer and full page parity",
          status: "review",
          executor: "claude",
          workspace: "/Users/dev/app",
          retry_count: 0,
          blocked_by: [],
          created_at: 1700000000,
          updated_at: 1700000100,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/worktree")) {
      return new Response(
        JSON.stringify({ branch: "sy/t_42", base_sha: "abc1234", worktree_dir: "/tmp/wt", dirty: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/diff")) {
      return new Response(JSON.stringify({ diff: "@@ -1 +1 @@\n-old\n+new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  let openedPageId = "";
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDrawer
        id="t_42"
        onClose={() => {}}
        review={() => {}}
        onOpenPage={(id) => {
          openedPageId = id;
        }}
      />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Implement 1:1 Task Detail")).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Overview/i })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Diff & Worktree/i })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Discussion/i })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /History/i })).toBeTruthy();

  fireEvent.click(screen.getAllByRole("button", { name: /Open full detail page/i })[0]);
  expect(openedPageId).toBe("t_42");
  unmount();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDetailPage id="t_42" onBack={() => {}} onReview={() => {}} />
    </QueryClientProvider>
  );
  expect(await screen.findByText("Implement 1:1 Task Detail")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Back to board/i })).toBeTruthy();
});

test("task detail page exposes a properties rail and lifecycle actions", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/tasks/t_rail")) {
      return new Response(
        JSON.stringify({
          id: "t_rail",
          board_id: "b_1",
          title: "Rail task",
          prompt: "Show the rail",
          status: "review",
          executor: "dsh",
          model: "deepseek-v4.1-flash",
          workspace: "/Users/dev/app",
          retry_count: 2,
          blocked_by: [],
          created_at: 1700000000,
          updated_at: 1700000100,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDetailPage id="t_rail" onBack={() => {}} onReview={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Rail task")).toBeTruthy();
  expect(screen.getByText("Lifecycle")).toBeTruthy();
  expect(screen.getByText("Execution")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Review diff/i })).toBeTruthy();
});
