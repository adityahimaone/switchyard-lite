import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { api, apiOr, LIVE_FALLBACK_MS, type Task, type Workspace } from "@/api";
import { TaskDetailPanels } from "@/components/board/TaskDetailContent";
import { TaskHeader } from "@/components/board/taskDetailParts";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export function TaskDrawer({
  id,
  onClose,
  review,
  onOpenPage,
}: {
  id: string;
  onClose: () => void;
  review: (id: string) => void;
  onOpenPage?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  const task = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<Task>(`/api/v1/tasks/${id}`),
    refetchInterval: LIVE_FALLBACK_MS,
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiOr<Workspace[]>("/api/v1/workspaces", []),
  });

  useEffect(() => {
    setEditing(false);
  }, [id]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const t = task.data;
  const matchedWs = workspaces.data?.find((w) => w.path === t?.workspace);

  const openFullPage = () => {
    if (onOpenPage) onOpenPage(id);
    else {
      onClose();
      location.hash = `#/task/${id}`;
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        id="task-detail-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t?.title ? `Task ${id}: ${t.title}` : `Task ${id}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="drawer-panel outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line/70 bg-well/55 px-5 py-2 text-[10.5px] font-mono tracking-[0.08em] text-ink-4 uppercase">
          <span>Task inspector</span>
          <span>Live telemetry</span>
        </div>

        <TaskHeader
          id={id}
          task={t}
          matchedWs={matchedWs}
          variant="drawer"
          editing={editing}
          onToggleEdit={() => setEditing((v) => !v)}
          onClose={onClose}
          onOpenPage={openFullPage}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas/35 px-5 py-4">
          <TaskDetailPanels
            id={id}
            variant="drawer"
            editing={editing}
            setEditing={setEditing}
            onDeleted={onClose}
            onReviewPage={(taskId) => {
              onClose();
              review(taskId);
            }}
          />
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface/85 px-5 py-3 backdrop-blur-md">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-4">
            <Kbd>esc</Kbd>
            <span>to close</span>
            <span className="mx-1 h-3 w-px bg-line" aria-hidden />
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            <span>to comment</span>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={openFullPage}>
            <Maximize2 className="size-3.5" />
            Open full page
          </Button>
        </footer>
      </aside>
    </div>
  );
}
