import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  Cpu,
  FolderGit2,
  GitPullRequest,
  Inbox,
  Kanban,
  Network,
  Plus,
  ScrollText,
  Search,
  Settings2,
  SunMoon,
  Workflow,
} from "@/components/ui/icons";
import { api, getToken, type Board, type Task } from "./api";
import { BoardDialog, BoardScreen, TaskDialog, useBoardId } from "./Board";
import { TaskDetailPage } from "@/components/board/TaskDetailPage";
import { TaskDrawer } from "./Drawer";
import { Login } from "./Login";
import { useLiveEvents } from "@/lib/live";
import { ReviewScreen } from "./Review";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AppInset,
  AppMain,
  AppShell,
  AppSidebar,
  AppSidebarBrand,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarItem,
  AppSidebarTrack,
} from "@/components/ui/app-shell";
import { StatusPill } from "@/components/ui/pill";
import {
  FlowScreen,
  LogsScreen,
  OverviewScreen,
  PipelineScreen,
  SettingsScreen,
  WorkersScreen,
  WorkspacesScreen,
} from "./Screens";
import { KnowledgeScreen } from "@/components/knowledge/KnowledgeScreen";
import { InboxScreen } from "@/components/studio/InboxScreen";
import { BoardEmojiTile } from "@/components/studio/StudioAssets";
import { isPipelinesEnabled } from "@/lib/features";
import { navigate, useRoute } from "@/lib/router";

const NAV = [
  { id: "board", label: "Board", group: "General", icon: Kanban },
  { id: "inbox", label: "Inbox", group: "General", icon: Inbox },
  { id: "review", label: "Review", group: "General", icon: GitPullRequest },
  { id: "pipelines", label: "Pipelines", group: "General", icon: Workflow },
  { id: "flow", label: "Flow map", group: "General", icon: Network },
  { id: "workspaces", label: "Workspaces", group: "Infrastructure", icon: FolderGit2 },
  { id: "workers", label: "Workers", group: "Infrastructure", icon: Cpu },
  { id: "overview", label: "Overview", group: "Observe", icon: Activity },
  { id: "logs", label: "Logs", group: "Observe", icon: ScrollText },
  { id: "knowledge", label: "Knowledge", group: "Observe", icon: BookOpen },
  { id: "settings", label: "Settings", group: "Footer", icon: Settings2 },
] as const;

export function useHash() {
  return useRoute();
}

export function App() {
  const qc = useQueryClient();
  const [authed, setAuthed] = useState(!!getToken());
  const hash = useHash();
  const [drawer, setDrawer] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [boardDialog, setBoardDialog] = useState<{ mode: "new" | "edit"; board?: Board } | null>(null);

  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const { boardId, activeBoard, boards, setBoardId } = useBoardId();

  const tasks = useQuery({
    queryKey: ["tasks", boardId],
    enabled: authed && !!boardId,
    queryFn: () => api<Task[]>(`/api/v1/boards/${boardId}/tasks`),
  });

  useEffect(() => {
    const f = () => setAuthed(false);
    addEventListener("switchyard:unauth", f);
    return () => removeEventListener("switchyard:unauth", f);
  }, []);

  // Single live stream drives all task/detail/overview refreshes.
  useLiveEvents(authed);

  // Global Cmd+K / Ctrl+K shortcut for Command Palette
  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const [route, arg] = hash.split("/");
  const page = route === "task" && arg ? "task" : NAV.some((item) => item.id === route) ? route : "board";
  const go = (p: string) => {
    navigate("/" + p.replace(/^\/+/, ""));
  };

  const taskList = tasks.data ?? [];
  const pipelinesEnabled = isPipelinesEnabled();
  const visibleNav = NAV.filter((item) => item.id !== "pipelines" || pipelinesEnabled);
  const reviewCount = taskList.filter((t) => t.status === "review").length;

  const groups = ["General", "Infrastructure", "Observe"] as const;

  return (
    <TooltipProvider>
    <AppShell>
      <AppSidebar>
        <div className="side-top-pod">
          <div className="side-top-row">
            <AppSidebarBrand name="Switchyard" tag="STUDIO" markSize={24} />
          </div>
          <div className="side-board-collapse">
            <div className="side-board-box space-y-2 pt-2.5">
              {activeBoard && (
              <Menu
                align="start"
                trigger={
                  <button
                    type="button"
                    aria-label="Sidebar switch board"
                    className="flex w-full items-center gap-2.5 rounded-[12px] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-well/45"
                  >
                    <BoardEmojiTile board={activeBoard} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
                        {activeBoard.name}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-ink-4">
                        {activeBoard.default_executor || "auto"} · {taskList.length} tasks
                      </div>
                    </div>
                    <ChevronDown className="size-3.5 shrink-0 text-ink-4" />
                  </button>
                }
              >
                <MenuLabel>Boards</MenuLabel>
                {(boards.data ?? []).map((b) => (
                  <MenuItem
                    key={b.id}
                    onSelect={() => {
                      setBoardId(b.id);
                      if (page !== "board" && page !== "inbox") go("board");
                    }}
                  >
                    <BoardEmojiTile board={b} size={18} className="rounded-[5px]" />
                    <span className="truncate">{b.name}</span>
                    {b.id === boardId && <Check className="ml-auto size-3.5 text-accent" />}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem icon={Plus} onSelect={() => setBoardDialog({ mode: "new" })}>
                  New board…
                </MenuItem>
                <MenuItem
                  icon={Settings2}
                  onSelect={() => setBoardDialog({ mode: "edit", board: activeBoard })}
                >
                  Board settings &amp; emoji…
                </MenuItem>
              </Menu>
            )}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-full items-center justify-between rounded-[10px] border border-line/70 bg-well px-3 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
              aria-label="Search tasks and boards"
            >
              <span className="inline-flex items-center gap-2">
                <Search className="size-3.5 text-ink-4" />
                <span>Search</span>
              </span>
              <Kbd>⌘K</Kbd>
            </button>
            <button
              type="button"
              disabled={!boardId}
              onClick={() => setTaskDialogOpen(true)}
              className="btn studio-scenic-cta flex h-9 w-full items-center justify-start gap-2 rounded-[10px] px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              <span>Compose task</span>
            </button>
            </div>
          </div>
        </div>

        <AppSidebarTrack>
          {groups.map((grp) => (
            <AppSidebarGroup key={grp} label={grp}>
              {visibleNav.filter((item) => item.group === grp).map((item) => {
                const Icon = item.icon;
                return (
                  <AppSidebarItem
                    key={item.id}
                    href={`/${item.id}`}
                    active={page === item.id}
                    title={item.label}
                    icon={<Icon className="nav-icon" aria-hidden />}
                    badge={item.id === "review" && reviewCount > 0 ? reviewCount : undefined}
                  >
                    {item.label}
                  </AppSidebarItem>
                );
              })}
            </AppSidebarGroup>
          ))}
        </AppSidebarTrack>

        <AppSidebarFooter>
          {NAV.filter((item) => item.group === "Footer").map((item) => {
            const Icon = item.icon;
            return (
              <AppSidebarItem
                key={item.id}
                href={`/${item.id}`}
                active={page === item.id}
                title={item.label}
                icon={<Icon className="nav-icon" aria-hidden />}
              >
                {item.label}
              </AppSidebarItem>
            );
          })}
          <div className="side-footer-bar">
            <button
              type="button"
              className="btn ghost icon size-8 shrink-0"
              onClick={() => {
                const isDark = document.documentElement.classList.toggle("dark");
                localStorage.setItem("switchyard.dark", isDark ? "1" : "");
              }}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              <SunMoon className="size-4" />
            </button>
            <span className="side-footer-status">
              <StatusPill status="online" size="sm" label="Online" />
            </span>
          </div>
        </AppSidebarFooter>
      </AppSidebar>

      <AppInset>
        <AppMain bleed={page === "board" || page === "task"}>
          {page === "board" && (
            <BoardScreen
              open={setDrawer}
              onNewBoard={() => setBoardDialog({ mode: "new" })}
              onEditBoard={(b) => setBoardDialog({ mode: "edit", board: b })}
            />
          )}
          {page === "inbox" && (
            <InboxScreen
              boardName={activeBoard?.name}
              tasks={tasks.data ?? []}
              onOpenTask={setDrawer}
              onNewTask={boardId ? () => setTaskDialogOpen(true) : undefined}
            />
          )}
          {page === "task" && arg && (
            <TaskDetailPage id={arg} onBack={() => go("board")} onReview={(id) => go("review/" + id)} />
          )}
          {page === "review" && <ReviewScreen taskId={arg} pick={(id) => go("review/" + id)} />}
          {page === "pipelines" && <PipelineScreen open={setDrawer} />}
          {page === "flow" && <FlowScreen open={setDrawer} />}
          {page === "workspaces" && <WorkspacesScreen />}
          {page === "overview" && <OverviewScreen />}
          {page === "logs" && <LogsScreen />}
          {page === "knowledge" && <KnowledgeScreen initialSlug={arg} onNavigate={go} />}
          {page === "workers" && <WorkersScreen />}
          {page === "settings" && <SettingsScreen logout={() => setAuthed(false)} />}
        </AppMain>
      </AppInset>

      {drawer && (
        <TaskDrawer
          id={drawer}
          onClose={() => setDrawer(undefined)}
          review={(id) => {
            setDrawer(undefined);
            go("review/" + id);
          }}
          onOpenPage={(id) => {
            setDrawer(undefined);
            go("task/" + id);
          }}
        />
      )}

      {boardDialog && (
        <BoardDialog
          mode={boardDialog.mode}
          board={boardDialog.board}
          onClose={() => setBoardDialog(null)}
          onSaved={(b) => {
            setBoardDialog(null);
            if (b?.id) {
              setBoardId(b.id);
              qc.invalidateQueries({ queryKey: ["boards"] });
            }
          }}
          onDeleted={() => {
            setBoardDialog(null);
            const remaining = (boards.data ?? []).filter((x) => x.id !== boardDialog.board?.id);
            setBoardId(remaining[0]?.id ?? "");
          }}
        />
      )}

      {taskDialogOpen && boardId && (
        <TaskDialog
          boardId={boardId}
          board={activeBoard}
          candidates={tasks.data ?? []}
          onClose={() => setTaskDialogOpen(false)}
        />
      )}

      {paletteOpen && (
        <CommandPaletteModal
          boards={boards.data ?? []}
          tasks={tasks.data ?? []}
          onClose={() => setPaletteOpen(false)}
          onSelectPage={(p) => {
            go(p);
            setPaletteOpen(false);
          }}
          onSelectBoard={(id) => {
            setBoardId(id);
            go("board");
            setPaletteOpen(false);
          }}
          onSelectTask={(id) => {
            setDrawer(id);
            setPaletteOpen(false);
          }}
          onNewBoard={() => {
            setPaletteOpen(false);
            setBoardDialog({ mode: "new" });
          }}
          onNewTask={
            boardId
              ? () => {
                  setPaletteOpen(false);
                  setTaskDialogOpen(true);
                }
              : undefined
          }
        />
      )}
    </AppShell>
    <Toaster />
    </TooltipProvider>
  );
}

function CommandPaletteModal({
  boards,
  tasks,
  onClose,
  onSelectPage,
  onSelectBoard,
  onSelectTask,
  onNewBoard,
  onNewTask,
}: {
  boards: Board[];
  tasks: Task[];
  onClose: () => void;
  onSelectPage: (page: string) => void;
  onSelectBoard: (id: string) => void;
  onSelectTask: (id: string) => void;
  onNewBoard: () => void;
  onNewTask?: () => void;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const needle = q.trim().toLowerCase();

  const matchedBoards = useMemo(
    () =>
      boards.filter(
        (b) => !needle || b.name.toLowerCase().includes(needle) || b.id.toLowerCase().includes(needle)
      ),
    [boards, needle]
  );

  const matchedTasks = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            !needle ||
            t.title.toLowerCase().includes(needle) ||
            t.id.toLowerCase().includes(needle)
        )
        .slice(0, 8),
    [tasks, needle]
  );

  const matchedPages = useMemo(
    () =>
      NAV.filter(
        (item) => !needle || item.label.toLowerCase().includes(needle) || item.id.includes(needle)
      ),
    [needle]
  );

  interface FlatItem {
    id: string;
    type: "board" | "task" | "page" | "action";
    run: () => void;
  }

  const flatItems = useMemo<FlatItem[]>(() => {
    const list: FlatItem[] = [];
    for (const b of matchedBoards) {
      list.push({ id: "board-" + b.id, type: "board", run: () => onSelectBoard(b.id) });
    }
    list.push({ id: "new-board", type: "action", run: onNewBoard });
    if (onNewTask) {
      list.push({ id: "new-task", type: "action", run: onNewTask });
    }
    for (const t of matchedTasks) {
      list.push({ id: "task-" + t.id, type: "task", run: () => onSelectTask(t.id) });
    }
    for (const p of matchedPages) {
      list.push({ id: "page-" + p.id, type: "page", run: () => onSelectPage(p.id) });
    }
    return list;
  }, [matchedBoards, matchedTasks, matchedPages, onSelectBoard, onSelectTask, onSelectPage, onNewBoard, onNewTask]);

  useEffect(() => {
    setActiveIdx(0);
  }, [needle]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % Math.max(1, flatItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => (prev - 1 + flatItems.length) % Math.max(1, flatItems.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIdx];
      if (item) item.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let currentIndex = 0;

  return (
    <div className="scrim-overlay" onClick={onClose}>
      <div
        className="cmd-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className="cmd-input-wrap">
          <Search className="size-4 text-[var(--c-ink-3)] shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search boards, tasks, screens, or type a command…"
            aria-label="Command search"
          />
          <kbd>ESC</kbd>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          {matchedBoards.length > 0 && (
            <div>
              <div className="nav-group-label">Boards ({matchedBoards.length})</div>
              {matchedBoards.map((b) => {
                const itemIndex = currentIndex++;
                const isSelected = activeIdx === itemIndex;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={"cmd-item" + (isSelected ? " selected" : "")}
                    onClick={() => onSelectBoard(b.id)}
                    onMouseEnter={() => setActiveIdx(itemIndex)}
                  >
                    <Kanban className="size-3.5 text-[var(--c-accent)] shrink-0" />
                    <span style={{ flex: 1, fontWeight: 500 }}>{b.name}</span>
                    <span className="mono muted" style={{ fontSize: 11 }}>
                      {b.id}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <div className="nav-group-label">Actions</div>
            {(() => {
              const itemIndex = currentIndex++;
              const isSelected = activeIdx === itemIndex;
              return (
                <button
                  type="button"
                  className={"cmd-item" + (isSelected ? " selected" : "")}
                  onClick={onNewBoard}
                  onMouseEnter={() => setActiveIdx(itemIndex)}
                  style={{ color: "var(--c-accent-text)" }}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span>Create new board…</span>
                </button>
              );
            })()}
            {onNewTask && (() => {
              const itemIndex = currentIndex++;
              const isSelected = activeIdx === itemIndex;
              return (
                <button
                  type="button"
                  className={"cmd-item" + (isSelected ? " selected" : "")}
                  onClick={onNewTask}
                  onMouseEnter={() => setActiveIdx(itemIndex)}
                  style={{ color: "var(--c-accent-text)" }}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span>Create new task…</span>
                </button>
              );
            })()}
          </div>

          {matchedTasks.length > 0 && (
            <div>
              <div className="nav-group-label">Tasks ({matchedTasks.length})</div>
              {matchedTasks.map((t) => {
                const itemIndex = currentIndex++;
                const isSelected = activeIdx === itemIndex;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={"cmd-item" + (isSelected ? " selected" : "")}
                    onClick={() => onSelectTask(t.id)}
                    onMouseEnter={() => setActiveIdx(itemIndex)}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.title}
                    </span>
                    <span className="badge">{t.status}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <div className="nav-group-label">Navigation</div>
            {matchedPages.map((item) => {
              const itemIndex = currentIndex++;
              const isSelected = activeIdx === itemIndex;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={"cmd-item" + (isSelected ? " selected" : "")}
                  onClick={() => onSelectPage(item.id)}
                  onMouseEnter={() => setActiveIdx(itemIndex)}
                >
                  <Icon className="size-3.5 text-[var(--c-ink-3)] shrink-0" />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    /{item.id}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-3.5 py-2 text-[11px] text-ink-4">
          {flatItems.length === 0 ? (
            <span>No matches — try a different keyword.</span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>navigate</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>↵</Kbd>
                <span>open</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>esc</Kbd>
                <span>close</span>
              </span>
              <span className="ml-auto tabular">{flatItems.length} results</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
