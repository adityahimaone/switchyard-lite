import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardScreen } from "./Board";
import { KnowledgeScreen } from "@/components/knowledge/KnowledgeScreen";

const origFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = origFetch;
  localStorage.clear();
});

test("Kanban card displays monitor badge, quick Retry, and clickable Grill-Me option pills", async () => {
  let answeredBody: Record<string, unknown> | null = null;
  let retriedId: string | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();

    if (url.endsWith("/api/v1/boards")) {
      return new Response(JSON.stringify([{ id: "b_1", name: "Main Board", created_at: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/boards/b_1/tasks")) {
      return new Response(
        JSON.stringify([
          {
            id: "t_track1",
            board_id: "b_1",
            title: "External dsh refactor",
            prompt: "Run via dsh",
            status: "in_progress",
            execution_mode: "tracker",
            executor: "dsh",
            session_id: "dsh_sess_9",
            retry_count: 0,
            blocked_by: [],
            question: {
              id: "q_1",
              task_id: "t_track1",
              question: "Which cache backend?",
              options: ["Use SQLite", "Use Redis"],
              status: "pending",
              author: "dsh",
              created_at: 100,
            },
            created_at: 100,
            updated_at: 200,
          },
          {
            id: "t_fail1",
            board_id: "b_1",
            title: "Build migration step",
            prompt: "Compile server",
            status: "failed",
            execution_mode: "managed",
            executor: "claude",
            retry_count: 1,
            error_sig: "compile error",
            blocked_by: [],
            created_at: 100,
            updated_at: 200,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/tasks/t_track1/questions/answer") && method === "POST") {
      answeredBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          question: { id: "q_1", task_id: "t_track1", question: "Which cache backend?", options: ["Use SQLite", "Use Redis"], status: "answered", answer: "Use SQLite", created_at: 100 },
          task: { id: "t_track1", board_id: "b_1", title: "External dsh refactor", prompt: "Run via dsh", status: "in_progress", execution_mode: "tracker", retry_count: 0, blocked_by: [], created_at: 100, updated_at: 200 },
          resumed: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/v1/tasks/t_fail1/retry") && method === "POST") {
      retriedId = "t_fail1";
      return new Response(JSON.stringify({ task: { id: "t_fail1", status: "todo" }, run_id: "run_retry" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardScreen open={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("monitor")).toBeTruthy();
  expect(screen.getByText("Which cache backend?")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Use SQLite" }));
  await waitFor(() => expect(answeredBody).not.toBeNull());
  expect(answeredBody).toMatchObject({
    question_id: "q_1",
    selected_options: ["Use SQLite"],
  });

  const retryBtn = screen.getByRole("button", { name: /Retry/i });
  fireEvent.click(retryBtn);
  await waitFor(() => expect(retriedId).toBe("t_fail1"));
});

test("KnowledgeScreen renders built-in MCP docs, filters via search, and lists SQLite custom docs", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/knowledge")) {
      return new Response(
        JSON.stringify([
          {
            id: "doc_1",
            slug: "team-dsh-rules",
            title: "Team DSH Playbook",
            subtitle: "Custom project rules stored in SQLite",
            category: "Custom Knowledge",
            badge: "Team",
            summary: "Shared conventions for dsh sessions.",
            content: "# DSH Playbook\n\nAlways bind task_id via MCP.",
            created_at: 100,
            updated_at: 200,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <KnowledgeScreen onNavigate={() => {}} />
    </QueryClientProvider>
  );

  expect(await screen.findByRole("heading", { name: "Switchyard-Lite Control Plane" })).toBeTruthy();
  expect(await screen.findByText("Team DSH Playbook")).toBeTruthy();
  expect(screen.getByText("Complete 62 MCP Tools Reference")).toBeTruthy();

  fireEvent.click(screen.getByText("Complete 62 MCP Tools Reference"));
  expect(await screen.findByRole("heading", { name: "Complete 62 MCP Tools Reference" })).toBeTruthy();

  const search = screen.getByPlaceholderText(/Search docs/i);
  fireEvent.change(search, { target: { value: "Playbook" } });
  expect(screen.getByText("Team DSH Playbook")).toBeTruthy();
  expect(screen.queryByText("Global Flow Map & Live Ping Telemetry")).toBeNull();
});
