import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiffView } from "./Review";
import { Dag, FlowScreen, layers, SettingsScreen } from "./Screens";
import { Login } from "./Login";
import { BoardScreen } from "./Board";
import { TaskDrawer } from "./Drawer";
import { TaskDialog, BoardDialog } from "./Board";
import { InboxScreen } from "@/components/studio/InboxScreen";
import { WorkflowTree } from "@/components/studio/WorkflowTree";
import { PreviewBrowserTab, WorktreeTerminalTab } from "@/components/studio/WorktreeStudioTabs";
import { WorkspacesPage } from "@/components/workspaces/WorkspacesPage";
import { TaskDetailPage } from "@/components/board/TaskDetailPage";
import { normalizeModels, parseModelCatalog } from "./api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SearchSelect } from "@/components/ui/select";
import { AvatarChip, CompoundActionPill, FilterPill, SearchField, StatusPill } from "@/components/ui/pill";
import { AppHeader, AppInset, AppMain, AppShell, AppSidebar, AppSidebarBrand, AppSidebarGroup, AppSidebarItem, AppSidebarToggle } from "@/components/ui/app-shell";
import { Kanban } from "@/components/ui/icons";
import { BrandLockup, BrandMark } from "@/components/ui/brand";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
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
  const switcher = screen.getByLabelText("Switch board");
  fireEvent.pointerDown(switcher);
  fireEvent.click(switcher);
  const betaOption = await screen.findByRole("option", { name: /Beta Board/i });
  fireEvent.click(betaOption);
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

test("task detail page exposes a properties rail and lifecycle actions", async () => {  globalThis.fetch = (async (input: RequestInfo | URL) => {
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

test("task dialog uses the searchable workspace picker with no inline path creation", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/boards")) {
      return new Response(JSON.stringify([{ id: "b_1", name: "Main Board" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/workspaces")) {
      return new Response(
        JSON.stringify([
          {
            id: "ws_1",
            name: "Switchyard Lite",
            path: "/Users/dev/switchyard-lite",
            host: "dev@box",
            os: "linux",
            kind: "ssh",
            status: "connected",
            labels: ["go", "react"],
          },
        ]),
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

  const btn = await screen.findByRole("button", { name: "New task" });
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);

  expect(await screen.findByRole("dialog")).toBeTruthy();
  const ws = await screen.findByLabelText("Workspace");
  expect(ws.tagName).toBe("BUTTON");

  fireEvent.pointerDown(ws);
  fireEvent.click(ws);
  expect(await screen.findByRole("option", { name: /No workspace \(scratch\)/i })).toBeTruthy();
  // Workspace creation belongs to the Workspaces page only.
  expect(screen.queryByText(/Custom path/i)).toBeNull();
  expect(screen.queryByLabelText(/Custom workspace path/i)).toBeNull();
});

test("no native select elements remain in the board flow", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/boards")) {
      return new Response(JSON.stringify([{ id: "b_1", name: "Main Board" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  await screen.findByRole("button", { name: "New task" });
  expect(container.querySelectorAll("select")).toHaveLength(0);
});

test("models normalize the node-agent value/label shape", () => {
  const raw = {
    executor: "dsh",
    detail: "",
    source: "probed",
    models: [
      { value: "adit-9router/kiro-cheap-combo-2", label: "kiro-cheap-combo-2", badge: "adit-9router" },
      {
        value: "deepseek/deepseek-v4-pro",
        label: "deepseek/deepseek-v4-pro",
        sublabel: "hybrid-attention long-context reasoning",
        badge: "deepseek",
      },
    ],
  };
  const list = normalizeModels(raw);
  expect(list.map((m) => m.id)).toEqual([
    "adit-9router/kiro-cheap-combo-2",
    "deepseek/deepseek-v4-pro",
  ]);
  expect(list[0].name).toBe("kiro-cheap-combo-2");
  expect(list[0].badge).toBe("adit-9router");
  expect(list.every((m) => m.id !== "undefined" && m.name !== "undefined")).toBe(true);
});

test("empty model catalog surfaces the upstream reason", () => {
  const cat = parseModelCatalog({
    executor: "claude",
    detail: "node has not reported this catalog yet",
    models: [],
    source: "pending",
  });
  expect(cat.models).toEqual([]);
  expect(cat.detail).toMatch(/has not reported/);
  expect(cat.source).toBe("pending");
});

test("switchyard-lite brandkit base components (Button, Select, Pill, AppShell, BrandMark) render cleanly", () => {
  const { container } = render(
    <AppShell defaultCollapsed={false}>
      <AppSidebar>
        <AppSidebarBrand name="Switchyard" tag="LITE" />
        <AppSidebarGroup label="Work">
          <AppSidebarItem href="/board" active badge={4}>
            Board
          </AppSidebarItem>
        </AppSidebarGroup>
      </AppSidebar>
      <AppInset>
        <AppHeader>
          <BrandLockup size={24} />
          <BrandMark size={16} />
          <StatusPill status="online" />
          <StatusPill status="working" />
        </AppHeader>
        <AppMain>
          <Button variant="prism">Ask AI</Button>
          <Button variant="obsidian">Book a Call</Button>
          <Button variant="dashed">Upload</Button>
          <FilterPill label="Filter" count={2} onClear={() => {}} />
          <AvatarChip name="Ella M." onRemove={() => {}} />
          <SearchField defaultValue="" placeholder="Search" />
          <CompoundActionPill valueLabel="30" unitLabel="mins" actionLabel="Book a Call" />
          <Select defaultValue="claude">
            <SelectTrigger aria-label="Executor select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude Sonnet</SelectItem>
            </SelectContent>
          </Select>
          <SearchSelect
            ariaLabel="Model picker"
            value="sonnet"
            options={[{ value: "sonnet", label: "Claude 4 Sonnet", badge: "fast" }]}
          />
        </AppMain>
      </AppInset>
    </AppShell>
  );

  expect(screen.getByRole("button", { name: "Ask AI" }).getAttribute("data-variant")).toBe("prism");
  expect(screen.getByRole("button", { name: "Upload" }).getAttribute("data-variant")).toBe("dashed");
  expect(screen.getByText("In progress")).toBeTruthy();
  expect(screen.getByText("Ella M.")).toBeTruthy();
  expect(container.querySelector('[data-slot="app-shell"]')).toBeTruthy();
  expect(container.querySelector('[data-slot="select-trigger"]')).toBeTruthy();
  expect(container.querySelector('[data-slot="search-select-trigger"]')).toBeTruthy();
});

test("flow screen renders global multi-board topology and traces selected task", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/flow/active")) {
      return new Response(
        JSON.stringify({
          retention_seconds: 1800,
          boards: [
            { id: "b_1", name: "Alpha", total: 1, active: 1 },
            { id: "b_2", name: "Beta", total: 1, active: 0 },
          ],
          workers: [
            {
              id: "w_mac",
              name: "Mac Studio",
              path: "/Users/dev/app",
              machine: "mac",
              status: "connected",
              latency_ms: 14,
            },
          ],
          tasks: [
            {
              task_id: "t_alpha1",
              title: "Implement auth middleware",
              board: "Alpha",
              board_id: "b_1",
              node_id: "mac-studio",
              machine: "mac",
              executor: "claude",
              transport: "worker",
              stage: "running",
              status: "in_progress",
              workspace: "/Users/dev/app",
              blocked_by: [],
              updated_at: 1000,
            },
            {
              task_id: "t_beta2",
              title: "Run meta7 design synthesis",
              board: "Beta",
              board_id: "b_2",
              run_id: "run_1",
              node_id: "",
              machine: "linux",
              executor: "codex",
              transport: "http",
              stage: "review",
              status: "review",
              workspace: "/srv/beta",
              blocked_by: [],
              updated_at: 990,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/logs")) {
      return new Response(JSON.stringify({ text: "log line 1", offset: 10, running: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <FlowScreen open={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Implement auth middleware")).toBeTruthy();
  expect(screen.getByText("Run meta7 design synthesis")).toBeTruthy();
  expect(screen.getByText("Autonomous Studio")).toBeTruthy();
  expect(screen.getByText("14ms")).toBeTruthy();

  fireEvent.click(screen.getByText("Implement auth middleware"));
  expect(await screen.findByText("Route Hops")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Replay Flow/i })).toBeTruthy();
});

test("liquid glass kanban board renders WIP bottleneck, empty in-progress CTA, retry X/3 badge, Run board (N), and click-to-copy ID", async () => {
  localStorage.clear();
  let dispatchedId = "";
  let copiedId = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copiedId = text;
      },
    },
  });

  const nowSec = Math.floor(Date.now() / 1000) - 120;
  const tasksPayload = [
    {
      id: "t_todo1",
      board_id: "b_1",
      title: "Implement liquid glass tokens",
      prompt: "Define glass.css variables and contrast hierarchy",
      status: "todo",
      executor: "claude",
      model: "claude-sonnet-4",
      workspace: "/Users/dev/next-portfolio-site",
      effort: "high",
      retry_count: 2,
      blocked_by: [],
      created_at: nowSec,
      updated_at: nowSec,
    },
    {
      id: "t_todo2",
      board_id: "b_1",
      title: "Add scroll fade mask",
      prompt: "Reveal offscreen Failed column",
      status: "todo",
      executor: "auto",
      retry_count: 0,
      blocked_by: [],
      created_at: nowSec,
      updated_at: nowSec,
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `t_rev${i + 1}`,
      board_id: "b_1",
      title: `Review item ${i + 1}`,
      prompt: "Verify diff and tests",
      status: "review",
      executor: "codex",
      retry_count: 0,
      blocked_by: [],
      created_at: nowSec,
      updated_at: nowSec,
    })),
  ];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/v1/boards")) {
      return new Response(
        JSON.stringify([{ id: "b_1", name: "Main Board", default_executor: "auto" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/boards/b_1/tasks")) {
      return new Response(JSON.stringify(tasksPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/tasks/t_todo1/dispatch") && method === "POST") {
      dispatchedId = "t_todo1";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Implement liquid glass tokens")).toBeTruthy();

  // Topbar Run board (2) label
  expect(screen.getByRole("button", { name: /Run board \(2\)/i })).toBeTruthy();

  // Retry 2/3 badge with dedicated class
  const retryBadge = screen.getByText(/retry 2\/3/i);
  expect(retryBadge.className).toContain("badge-retry");

  // Click-to-copy task ID
  const copyIdBtn = screen.getByRole("button", { name: "Copy task id t_todo1" });
  fireEvent.click(copyIdBtn);
  await waitFor(() => expect(copiedId).toBe("t_todo1"));

  // Review WIP bottleneck indicator (6/5 WIP)
  const wipBadge = screen.getByTestId("review-wip-badge");
  expect(wipBadge.textContent).toContain("6/5 WIP");
  const reviewCol = container.querySelector('.col[data-status="review"]');
  expect(reviewCol?.getAttribute("data-wip-exceeded")).toBe("true");

  // Empty In progress CTA dispatches the first eligible todo task
  expect(screen.getByText("No active runs")).toBeTruthy();
  const runNextBtn = screen.getByRole("button", { name: /Run next task/i });
  fireEvent.click(runNextBtn);
  await waitFor(() => expect(dispatchedId).toBe("t_todo1"));

  // Dragging disables card blur and applies is-dragging class
  const cardEl = copyIdBtn.closest(".card") as HTMLElement;
  fireEvent.dragStart(cardEl, { dataTransfer: { setData: () => {} } });
  expect(cardEl.classList.contains("is-dragging")).toBe(true);
  expect(container.querySelector('.board[data-dragging="true"]')).toBeTruthy();
  fireEvent.dragEnd(cardEl);
  expect(cardEl.classList.contains("is-dragging")).toBe(false);
});

test("sidebar toggle and Cmd+B collapse/expand AppShell and expose badge dot", () => {
  const { container } = render(
    <AppShell defaultCollapsed={false}>
      <AppSidebar>
        <div className="side-top-pod">
          <div className="side-top-row">
            <AppSidebarBrand name="Switchyard" tag="LITE" />
            <AppSidebarToggle />
          </div>
        </div>
        <AppSidebarGroup label="Work">
          <AppSidebarItem href="/review" icon={<Kanban className="nav-icon" />} badge={6}>
            Review
          </AppSidebarItem>
        </AppSidebarGroup>
      </AppSidebar>
      <AppInset>
        <AppMain>content</AppMain>
      </AppInset>
    </AppShell>
  );

  const shell = container.querySelector('[data-slot="app-shell"]') as HTMLElement;
  expect(shell.getAttribute("data-collapsed")).toBeNull();
  expect(container.querySelector(".nav-badge-dot")).toBeTruthy();

  const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
  fireEvent.click(toggle);
  expect(shell.getAttribute("data-collapsed")).toBe("true");
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();

  fireEvent.keyDown(window, { key: "b", metaKey: true });
  expect(shell.getAttribute("data-collapsed")).toBeNull();
});

test("task drawer and detail page expose LifecycleStepper, solid primary Dispatch now, and retry 2/3 badge", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/tasks/t_lg1")) {
      return new Response(
        JSON.stringify({
          id: "t_lg1",
          board_id: "b_1",
          title: "Verify glass detail drawer",
          prompt: "Check lifecycle stepper and retry badge",
          status: "todo",
          executor: "claude",
          effort: "high",
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

  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDrawer id="t_lg1" onClose={() => {}} review={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Verify glass detail drawer")).toBeTruthy();
  expect(screen.getByLabelText("Task lifecycle progression")).toBeTruthy();
  expect(screen.getByText(/retry 2\/3/i)).toBeTruthy();
  const dispatchDrawerBtn = screen.getByRole("button", { name: /Dispatch now/i });
  expect(dispatchDrawerBtn.className).toContain("btn primary");
  unmount();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDetailPage id="t_lg1" onBack={() => {}} onReview={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Verify glass detail drawer")).toBeTruthy();
  expect(screen.getByLabelText("Task lifecycle progression")).toBeTruthy();
  expect(screen.getAllByText(/retry 2\/3/i).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("button", { name: /Dispatch now/i }).className).toContain("btn primary");
});

test("TaskDialog exposes agy 6-level thinking presets and switches agy-auth accounts", async () => {
  window.localStorage.removeItem("switchyard.executors.config");
  let switchedAccount = "";
  let activeAccount = "personal@example.com";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/settings/executors")) {
      return new Response(JSON.stringify({ order: ["agy", "claude", "codex"], hidden: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/models?executor=agy")) {
      return new Response(
        JSON.stringify({
          executor: "agy",
          source: "cli",
          models: [{ id: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/agy/accounts")) {
      return new Response(
        JSON.stringify({
          available: true,
          active: activeAccount,
          accounts: [
            { id: "id-1", email: "personal@example.com", name: "Personal", active: activeAccount === "personal@example.com" },
            { id: "id-2", email: "work@example.com", name: "Work", active: activeAccount === "work@example.com" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/agy/accounts/switch") && init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}")) as { account?: string };
      switchedAccount = body.account ?? "";
      activeAccount = switchedAccount;
      return new Response(JSON.stringify({ ok: true, active: activeAccount }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDialog open boardId="b_1" onClose={() => {}} />
    </QueryClientProvider>
  );

  const execTrigger = await screen.findByLabelText("Executor");
  fireEvent.pointerDown(execTrigger);
  fireEvent.click(execTrigger);
  const agyOption = await screen.findByRole("option", { name: /Antigravity CLI \(agy\)/i });
  fireEvent.click(agyOption);

  expect(await screen.findByTestId("agy-account-picker")).toBeTruthy();
  expect(screen.getByText("auto-approve")).toBeTruthy();

  const effortTrigger = screen.getByLabelText("Effort");
  fireEvent.pointerDown(effortTrigger);
  fireEvent.click(effortTrigger);
  for (const label of ["minimal (maps to low)", "low", "medium", "high", "xhigh", "max"]) {
    expect(await screen.findByRole("option", { name: label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("option", { name: "xhigh" }));

  const acctTrigger = await screen.findByLabelText("AGY account");
  fireEvent.pointerDown(acctTrigger);
  fireEvent.click(acctTrigger);
  const workOpt = await screen.findByRole("option", { name: /Work \(work@example\.com\)/i });
  fireEvent.click(workOpt);

  await waitFor(() => expect(switchedAccount).toBe("work@example.com"));
});

test("SettingsScreen swaps and hides executors and reflects them in TaskDialog", async () => {
  window.localStorage.removeItem("switchyard.executors.config");
  let savedConfig = {
    order: ["agy", "claude", "codex", "commandcode", "omp", "dsh"],
    hidden: [] as string[],
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/settings/executors") && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(savedConfig), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/settings/executors") && init?.method === "POST") {
      savedConfig = JSON.parse(String(init.body || "{}"));
      return new Response(JSON.stringify(savedConfig), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/settings/review")) {
      return new Response(JSON.stringify({ auto_merge: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/settings/password")) {
      return new Response(JSON.stringify({ configured: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/agy/accounts")) {
      return new Response(JSON.stringify({ available: false, accounts: [], active: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsScreen logout={() => {}} />
    </QueryClientProvider>
  );

  await screen.findByTestId("executors-order-list");
  await waitFor(() => {
    const items = Array.from(screen.getByTestId("executors-order-list").children);
    expect(items[1]?.textContent).toContain("Claude Code");
  });
  fireEvent.click(screen.getByLabelText("Move claude up"));
  await waitFor(() => expect(savedConfig.order.slice(0, 2)).toEqual(["claude", "agy"]));

  fireEvent.click(screen.getByLabelText("Hide omp"));
  await waitFor(() => expect(savedConfig.hidden).toContain("omp"));
  unmount();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDialog open boardId="b_1" onClose={() => {}} />
    </QueryClientProvider>
  );

  const execTrigger = await screen.findByLabelText("Executor");
  fireEvent.pointerDown(execTrigger);
  fireEvent.click(execTrigger);

  const opts = await screen.findAllByRole("option");
  const texts = opts.map((o) => o.textContent ?? "");
  expect(texts.some((t) => t.includes("omp (oh-my-pi)"))).toBe(false);
  const claudeIdx = texts.findIndex((t) => t.includes("Claude Code"));
  const agyIdx = texts.findIndex((t) => t.includes("Antigravity CLI (agy)"));
  expect(claudeIdx).toBeGreaterThan(-1);
  expect(agyIdx).toBeGreaterThan(claudeIdx);
});

test("TaskDialog tracks workspace machine availability, auto-selects available executor, and shows all 4 agy-auth accounts", async () => {
  window.localStorage.removeItem("switchyard.executors.config");
  const seenAccountQueries: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/workspaces")) {
      return new Response(
        JSON.stringify([
          { id: "ws_win", name: "Win App", path: "D:\\xampp\\htdocs\\portal", os: "windows", host: "rtx", status: "connected" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/v1/executors/probe")) {
      return new Response(
        JSON.stringify({
          workspace: "D:\\xampp\\htdocs\\portal",
          machine: "windows",
          machine_label: "Windows",
          is_local: false,
          probed: true,
          installed: { agy: true, claude: false, codex: true, commandcode: false, omp: false, dsh: false },
          available_executors: ["agy", "codex"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.startsWith("/api/v1/agy/accounts")) {
      seenAccountQueries.push(url);
      return new Response(
        JSON.stringify({
          available: true,
          machine: "windows",
          machine_label: "Windows",
          active: "izonelikeswan@gmail.com",
          accounts: [
            { id: "acct_a30e78a3a6", email: "adityahimaone@gmail.com", name: "personal", alias: "personal", plan: "Pro", quota_5h: "79%", active: false },
            { id: "acct_de5a253671", email: "izonelikeswan@gmail.com", name: "work-2", alias: "work-2", plan: "Pro", quota_5h: "73%", active: true },
            { id: "acct_7f340fd018", email: "swanlike101@gmail.com", name: "work-1", alias: "work-1", active: false },
            { id: "acct_6d8505dcc2", email: "swanlike102@gmail.com", name: "work-3", alias: "work-3", active: false },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/settings/executors")) {
      return new Response(JSON.stringify({ order: ["agy", "claude", "codex", "commandcode", "omp", "dsh"], hidden: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDialog
        open
        boardId="b_win"
        board={{ id: "b_win", name: "Win Board", default_executor: "dsh" }}
        onClose={() => {}}
      />
    </QueryClientProvider>
  );

  const badge = await screen.findByTestId("task-executor-machine-badge");
  await waitFor(() => expect(badge.textContent).toContain("Windows"));
  await waitFor(() => expect(badge.textContent).toContain("2/6 installed"));

  // Auto-selected first installed executor ("agy") when board default ("dsh") is absent on Windows.
  expect(await screen.findByTestId("agy-account-picker")).toBeTruthy();
  expect(screen.getByText("4 accts")).toBeTruthy();
  expect(seenAccountQueries.some((q) => q.includes("D%3A%5Cxampp%5Chtdocs%5Cportal"))).toBe(true);

  const acctTrigger = await screen.findByLabelText("AGY account");
  fireEvent.pointerDown(acctTrigger);
  fireEvent.click(acctTrigger);
  expect(await screen.findByRole("option", { name: /personal \(adityahimaone@gmail\.com\)/i })).toBeTruthy();
  expect(await screen.findByRole("option", { name: /work-1 \(swanlike101@gmail\.com\)/i })).toBeTruthy();
  expect(await screen.findByRole("option", { name: /work-2 \(izonelikeswan@gmail\.com\)/i })).toBeTruthy();
  expect(await screen.findByRole("option", { name: /work-3 \(swanlike102@gmail\.com\)/i })).toBeTruthy();

  // Unavailable executors on Windows show clear missing status.
  const execTrigger = screen.getByLabelText("Executor");
  fireEvent.pointerDown(execTrigger);
  fireEvent.click(execTrigger);
  expect(await screen.findByRole("option", { name: /Claude Code \(not installed on Windows\)/i })).toBeTruthy();
});

test("TaskDialog redesigned composer renders inline styled tokens for attached @file and $skill", async () => {
  window.localStorage.removeItem("switchyard.executors.config");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/skills")) {
      return new Response(
        JSON.stringify({ skills: [{ name: "ui-ux-pro-max", description: "Design skills", linked: true }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/settings/executors")) {
      return new Response(JSON.stringify({ order: ["agy", "claude"], hidden: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDialog open boardId="b_1" board={{ id: "b_1", name: "Main" }} onClose={() => {}} />
    </QueryClientProvider>
  );

  const promptBox = await screen.findByLabelText("Prompt");
  fireEvent.focus(promptBox);
  fireEvent.change(promptBox, { target: { value: "Polish @web/TaskDialog.tsx with $ui-ux-pro-max" } });
  fireEvent.blur(promptBox);

  const backdrop = screen.getByTestId("prompt-rich-backdrop");
  expect(backdrop.querySelector('[data-token-kind="file"]')?.textContent).toBe("@web/TaskDialog.tsx");
  expect(backdrop.querySelector('[data-token-kind="skill"]')?.textContent).toBe("$ui-ux-pro-max");
  expect(backdrop.querySelector('[data-token-kind="file"]')?.className).toContain("font-mono");
  expect(backdrop.querySelector('[data-token-kind="skill"]')?.className).toContain("font-mono");
});

test("Wave 1 Studio: waiting_input column, auto-collapsed empty secondary columns, mid-card switch, and Grill-Me First toggle", async () => {
  localStorage.clear();
  let answerBody: Record<string, unknown> | null = null;
  let createdTaskBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/v1/boards")) {
      return new Response(JSON.stringify([{ id: "b_w1", name: "Studio Board", default_executor: "agy" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/boards/b_w1/tasks")) {
      return new Response(
        JSON.stringify([
          {
            id: "t_wait1",
            board_id: "b_w1",
            title: "Clarify auth provider",
            prompt: "Add OAuth",
            status: "waiting_input",
            executor: "agy",
            model: "gemini-2.5-pro",
            grill_me: true,
            retry_count: 0,
            blocked_by: [],
            created_at: 1700000000,
            updated_at: 1700000010,
            question: {
              id: "q_wait1",
              task_id: "t_wait1",
              question: "Which OAuth provider should we wire?",
              options: ["Google", "GitHub"],
              multi_select: false,
              status: "pending",
              author: "agy",
              created_at: 1700000010,
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/settings/executors")) {
      return new Response(JSON.stringify({ order: ["agy", "dsh", "commandcode"], hidden: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/v1/models")) {
      return new Response(JSON.stringify({ models: [{ id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/tasks/t_wait1/questions/answer") && method === "POST") {
      answerBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, resumed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/tasks") && method === "POST") {
      createdTaskBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ id: "t_new_gm", board_id: "b_w1", title: "Grill me task", status: "todo" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const { container, unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Clarify auth provider")).toBeTruthy();
  expect(container.querySelector('[data-status="waiting_input"]')).toBeTruthy();
  expect(container.querySelector('[data-status="backlog"]')?.getAttribute("data-collapsed")).toBe("true");
  expect(container.querySelector('[data-status="blocked"]')?.getAttribute("data-collapsed")).toBe("true");
  expect(container.querySelector('[data-status="failed"]')?.getAttribute("data-collapsed")).toBe("true");

  // Mid-card harness/model switch on TaskQuestionCard
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  const harnessSelect = await screen.findByLabelText("Switch harness");
  fireEvent.pointerDown(harnessSelect);
  fireEvent.click(harnessSelect);
  fireEvent.click(await screen.findByRole("option", { name: /DeepSeek Harness/i }));

  const modelSelect = await screen.findByLabelText("Switch model");
  fireEvent.pointerDown(modelSelect);
  fireEvent.click(modelSelect);
  fireEvent.click(await screen.findByRole("option", { name: /DeepSeek V4\.1 Flash/i }));

  fireEvent.click(screen.getByRole("button", { name: "Google" }));
  await waitFor(() => expect(answerBody).not.toBeNull());
  expect(answerBody).toMatchObject({
    question_id: "q_wait1",
    selected_options: ["Google"],
    executor: "dsh",
    model: "deepseek-v4.1-flash",
  });
  unmount();

  // TaskDialog hides meta7 by default and sends grill_me: true when toggled ON
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDialog open boardId="b_w1" board={{ id: "b_w1", name: "Studio Board" }} onClose={() => {}} />
    </QueryClientProvider>
  );

  expect(screen.queryByRole("radio", { name: "meta7" })).toBeNull();
  const grillSwitch = await screen.findByRole("switch");
  fireEvent.click(grillSwitch);
  expect(grillSwitch.getAttribute("aria-checked")).toBe("true");

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Design API schema" } });
  fireEvent.click(screen.getByRole("button", { name: /Create task/i }));
  await waitFor(() => expect(createdTaskBody).not.toBeNull());
  expect(createdTaskBody).toMatchObject({
    title: "Design API schema",
    grill_me: true,
  });
});

test("Wave 2 & 3 Studio: InboxScreen grouped triage, WorkflowTree dot-grid, Terminal exec, and PreviewBrowser", async () => {
  let execCmd = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/tasks/t_studio1/terminal/exec") && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      execCmd = body.command;
      return new Response(
        JSON.stringify({ stdout: "On branch sy/t_studio1\n", stderr: "", exit_code: 0, cwd: "/tmp/wt", duration_ms: 12 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const sampleTask = {
    id: "t_studio1",
    board_id: "b_1",
    title: "Redesign Studio Shell",
    prompt: "Apply warm light tactile design system",
    status: "waiting_input" as const,
    executor: "dsh",
    model: "deepseek-v4.1-flash",
    workspace: "/Users/dev/switchyard-lite",
    branch: "main",
    paths: ["web/src/App.tsx"],
    skills: ["frontend-design"],
    mcps: ["context7"],
    retry_count: 0,
    blocked_by: [],
    created_at: Math.floor(Date.now() / 1000) - 60,
    updated_at: Math.floor(Date.now() / 1000) - 30,
  };

  const qc = new QueryClient();
  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <InboxScreen boardName="Main Studio" tasks={[sampleTask]} onOpenTask={() => {}} onNewTask={() => {}} />
    </QueryClientProvider>
  );
  expect(screen.getByTestId("studio-inbox-view")).toBeTruthy();
  expect(screen.getByText("Redesign Studio Shell")).toBeTruthy();
  expect(screen.getByText("App.tsx")).toBeTruthy();
  unmount();

  const { unmount: unmountTree } = render(
    <QueryClientProvider client={qc}>
      <WorkflowTree task={sampleTask} subtasks={[]} variant="detail" />
    </QueryClientProvider>
  );
  expect(screen.getByTestId("workflow-tree-canvas")).toBeTruthy();
  expect(screen.getByText("Tech-Stack")).toBeTruthy();
  expect(screen.getByText("context7")).toBeTruthy();
  unmountTree();

  const { unmount: unmountTerm } = render(
    <QueryClientProvider client={qc}>
      <WorktreeTerminalTab task={sampleTask} />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "git status -sb" }));
  await waitFor(() => expect(execCmd).toBe("git status -sb"));
  expect(await screen.findByText(/On branch sy\/t_studio1/)).toBeTruthy();
  unmountTerm();

  render(
    <QueryClientProvider client={qc}>
      <PreviewBrowserTab task={sampleTask} />
    </QueryClientProvider>
  );
  expect(screen.getByTestId("preview-browser-tab")).toBeTruthy();
  expect(screen.getByTitle("Preview localhost:5173")).toBeTruthy();
});

test("BoardDialog persists board emoji, BoardEmojiTile renders it, and Dark Mode renders without native selects", async () => {
  let createdBoard: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/boards") && init?.method === "POST") {
      createdBoard = JSON.parse(String(init.body ?? "{}"));
      return new Response(
        JSON.stringify({ id: "b_emoji", name: createdBoard?.name, emoji: createdBoard?.emoji }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  document.documentElement.classList.add("dark");
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardDialog mode="new" onClose={() => {}} onSaved={() => {}} />
    </QueryClientProvider>
  );

  expect(container.querySelectorAll("select")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "Design System" } });
  fireEvent.click(screen.getByRole("button", { name: "Select emoji 🚀" }));
  expect(screen.getByTestId("board-emoji-tile").textContent).toBe("🚀");

  fireEvent.click(screen.getByRole("button", { name: "Create board" }));
  await waitFor(() => expect(createdBoard).not.toBeNull());
  expect(createdBoard).toMatchObject({ name: "Design System", emoji: "🚀" });
  document.documentElement.classList.remove("dark");
});
