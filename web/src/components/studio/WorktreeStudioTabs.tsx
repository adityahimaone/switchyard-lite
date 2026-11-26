import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Laptop, Monitor, Play, RefreshCw, Send, Terminal } from "@/components/ui/icons";
import { post, type Task } from "@/api";
import { toast, toastError } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface TermEntry {
  cmd: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  cwd: string;
  duration_ms: number;
}

export function WorktreeTerminalTab({ task }: { task: Task }) {
  const [cmd, setCmd] = useState("");
  const [entries, setEntries] = useState<TermEntry[]>([]);

  const execMut = useMutation({
    mutationFn: (command: string) =>
      post<{ stdout: string; stderr: string; exit_code: number; cwd: string; duration_ms: number }>(
        `/api/v1/tasks/${task.id}/terminal/exec`,
        { command }
      ),
    onSuccess: (res, command) => {
      setEntries((prev) => [...prev, { cmd: command, ...res }]);
      setCmd("");
    },
    onError: (e) => toastError(e, "Terminal command failed"),
  });

  const run = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed || execMut.isPending) return;
    execMut.mutate(trimmed);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="worktree-terminal-tab">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3">
          <Terminal className="size-3.5" />
          Quick commands:
        </span>
        {["git status -sb", "git diff --stat", "ls -la"].map((quick) => (
          <button
            key={quick}
            type="button"
            onClick={() => run(quick)}
            disabled={execMut.isPending}
            className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:border-accent hover:text-accent"
          >
            {quick}
          </button>
        ))}
      </div>

      <div className="min-h-[240px] max-h-[380px] overflow-y-auto rounded-[14px] border border-line-strong bg-[#0d1117] p-3.5 font-mono text-[12px] text-slate-100">
        {entries.length === 0 ? (
          <div className="text-slate-400">
            # Scoped to worktree for {task.id} ({task.workspace || "no workspace"})
            <br /># Type a shell command below or click a quick command above.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((e, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-sky-400">
                    $ {e.cmd}
                  </span>
                  <span className={cn("tabular-nums", e.exit_code === 0 ? "text-emerald-400" : "text-rose-400")}>
                    exit {e.exit_code} · {e.duration_ms}ms
                  </span>
                </div>
                {e.stdout && <pre className="m-0 whitespace-pre-wrap break-words text-slate-100">{e.stdout}</pre>}
                {e.stderr && <pre className="m-0 whitespace-pre-wrap break-words text-rose-300">{e.stderr}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(cmd);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="Run command in task worktree (e.g. go test ./... or pnpm test)..."
          aria-label="Worktree terminal command"
          className="h-9 flex-1 rounded-[10px] border border-line-strong bg-surface px-3 font-mono text-[12px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!cmd.trim() || execMut.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          <Play className="size-3 fill-current" />
          Run
        </button>
      </form>
    </div>
  );
}

export function PreviewBrowserTab({ task }: { task: Task }) {
  const qc = useQueryClient();
  const [port, setPort] = useState("5173");
  const [path, setPath] = useState("/");
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [nonce, setNonce] = useState(0);
  const [feedback, setFeedback] = useState("");

  const cleanPath = path.startsWith("/") ? path : "/" + path;
  const previewUrl = `/api/v1/preview/${task.id}/${encodeURIComponent(port || "5173")}${cleanPath}${
    cleanPath.includes("?") ? "&" : "?"
  }_t=${nonce}`;

  const sendFeedback = useMutation({
    mutationFn: () =>
      post(`/api/v1/tasks/${task.id}/comments`, {
        author: "reviewer",
        body: `[Preview localhost:${port}${cleanPath} · ${viewport}] ${feedback.trim()}`,
      }),
    onSuccess: () => {
      setFeedback("");
      qc.invalidateQueries({ queryKey: ["comments", task.id] });
      toast("Preview feedback posted to task", { tone: "success" });
    },
    onError: (e) => toastError(e, "Failed to post feedback"),
  });

  const widthClass = viewport === "mobile" ? "max-w-[390px]" : viewport === "tablet" ? "max-w-[768px]" : "w-full";

  return (
    <div className="flex flex-col gap-3" data-testid="preview-browser-tab">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-2.5 py-1 font-mono text-[11.5px]">
          <span className="text-ink-4">localhost:</span>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
            aria-label="Preview port"
            className="w-14 bg-transparent font-semibold text-ink outline-none"
          />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            aria-label="Preview path"
            className="w-28 border-l border-line pl-2 text-ink-2 outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-line bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:border-accent hover:text-accent"
        >
          <RefreshCw className="size-3" />
          Reload
        </button>

        <div className="ml-auto inline-flex items-center rounded-[9px] border border-line bg-well p-0.5 text-[11px]">
          {(
            [
              { id: "desktop", label: "Desktop", Icon: Monitor },
              { id: "tablet", label: "Tablet", Icon: Laptop },
              { id: "mobile", label: "Mobile", Icon: ExternalLink },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewport(id)}
              className={cn(
                "rounded-[7px] px-2.5 py-1 font-medium transition-colors",
                viewport === id ? "bg-surface text-ink shadow-2xs" : "text-ink-3 hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-center rounded-[14px] border border-line-strong bg-well/70 p-2">
        <iframe
          key={`${port}-${cleanPath}-${nonce}`}
          src={previewUrl}
          title={`Preview localhost:${port}`}
          className={cn("h-[340px] rounded-[10px] border border-line bg-white shadow-sm", widthClass)}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (feedback.trim()) sendFeedback.mutate();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Send visual feedback about this preview to the agent..."
          className="h-9 flex-1 rounded-[10px] border border-line-strong bg-surface px-3 text-[12px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!feedback.trim() || sendFeedback.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          <Send className="size-3" />
          Send feedback
        </button>
      </form>
    </div>
  );
}
