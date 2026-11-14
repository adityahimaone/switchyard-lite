import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, type Task, type TaskQuestion } from "@/api";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, HelpCircle, Plus } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast, toastError } from "@/components/ui/toast";

interface AnswerResponse {
  question: TaskQuestion;
  task: Task;
  resumed: boolean;
  run_id?: string;
}

export function TaskQuestionCard({
  task,
  variant = "card",
}: {
  task: Task;
  variant?: "card" | "detail";
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newOpts, setNewOpts] = useState("");
  const [newMulti, setNewMulti] = useState(false);

  const questionsQuery = useQuery({
    queryKey: ["questions", task.id],
    queryFn: () => api<TaskQuestion[]>(`/api/v1/tasks/${task.id}/questions`),
    enabled: variant === "detail",
    refetchInterval: variant === "detail" ? 4000 : false,
  });

  const answerMut = useMutation({
    mutationFn: (payload: {
      question_id?: string;
      selected_options?: string[];
      answer?: string;
    }) =>
      post<AnswerResponse>(`/api/v1/tasks/${task.id}/questions/answer`, {
        ...payload,
        author: "user",
      }),
    onSuccess: (res) => {
      setSelected([]);
      setCustomAnswer("");
      setCustomOpen(false);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["questions", task.id] });
      qc.invalidateQueries({ queryKey: ["comments", task.id] });
      qc.invalidateQueries({ queryKey: ["runs", task.id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast(
        res.resumed
          ? "Answer sent and run resumed"
          : "Answer recorded on card",
        { tone: "success" }
      );
    },
    onError: (e) => toastError(e, "Failed to submit answer"),
  });

  const askMut = useMutation({
    mutationFn: () =>
      post<TaskQuestion>(`/api/v1/tasks/${task.id}/questions`, {
        question: newQ.trim(),
        options: newOpts
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean),
        multi_select: newMulti,
        author: "user",
      }),
    onSuccess: () => {
      setNewQ("");
      setNewOpts("");
      setNewMulti(false);
      setAskOpen(false);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["questions", task.id] });
      toast("Question added to card", { tone: "info" });
    },
    onError: (e) => toastError(e, "Failed to create question"),
  });

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  if (variant === "card") {
    const q = task.question;
    if (!q || q.status !== "pending") return null;

    const toggleOption = (opt: string) => {
      if (!q.multi_select) {
        answerMut.mutate({ question_id: q.id, selected_options: [opt] });
        return;
      }
      setSelected((prev) =>
        prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]
      );
    };

    return (
      <div
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        data-testid={`question-card-${task.id}`}
        className="mt-2 rounded-[8px] border border-review/35 bg-review-tint/70 px-2.5 py-2 text-left"
      >
        <div className="flex items-center justify-between gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-review-text">
          <span className="inline-flex items-center gap-1 truncate">
            <HelpCircle className="size-3 shrink-0" />
            <span className="truncate">{q.author || task.executor || "Question"}</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCustomOpen((v) => !v);
            }}
            className="text-[10px] font-medium normal-case tracking-normal text-ink-3 hover:text-ink underline-offset-2 hover:underline"
          >
            {customOpen ? "Cancel" : "Reply"}
          </button>
        </div>

        <div className="mt-1 text-[11.5px] font-medium leading-snug text-ink line-clamp-2">
          {q.question}
        </div>

        {q.options && q.options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const isSel = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={answerMut.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleOption(opt);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight transition-colors",
                    isSel
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line-strong bg-surface text-ink hover:border-accent hover:bg-accent-tint hover:text-accent-text",
                    answerMut.isPending && "opacity-60 pointer-events-none"
                  )}
                >
                  {isSel && <Check className="size-2.5" />}
                  <span className="max-w-[175px] truncate">{opt}</span>
                </button>
              );
            })}
            {q.multi_select && selected.length > 0 && (
              <button
                type="button"
                disabled={answerMut.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  answerMut.mutate({ question_id: q.id, selected_options: selected });
                }}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-on-accent shadow-[var(--lift-1)]"
              >
                Send ({selected.length})
              </button>
            )}
          </div>
        )}

        {(customOpen || !q.options || q.options.length === 0) && (
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!customAnswer.trim() && selected.length === 0) return;
              answerMut.mutate({
                question_id: q.id,
                selected_options: selected,
                answer: customAnswer.trim(),
              });
            }}
          >
            <Input
              value={customAnswer}
              onChange={(e) => setCustomAnswer(e.target.value)}
              placeholder="Type reply..."
              className="h-7 flex-1 rounded-md bg-surface px-2 text-[11px]"
            />
            <Button
              type="submit"
              size="xs"
              disabled={answerMut.isPending || (!customAnswer.trim() && selected.length === 0)}
            >
              Send
            </Button>
          </form>
        )}
      </div>
    );
  }

  // Detail drawer/modal variant
  const list = questionsQuery.data ?? (task.question ? [task.question] : []);
  const pending = list.filter((q) => q.status === "pending");
  const resolved = list.filter((q) => q.status !== "pending");
  const activeQ = pending[0];

  return (
    <section className="rounded-[12px] border border-line bg-surface p-3.5 shadow-[var(--lift-1)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="size-4 text-review" />
          <h4 className="text-[12.5px] font-semibold text-ink">
            Open Questions & Grill-Me
          </h4>
          {pending.length > 0 && (
            <Badge variant="review">{pending.length} pending</Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setAskOpen((v) => !v)}
        >
          <Plus className="size-3.5" />
          {askOpen ? "Close" : "Ask question"}
        </Button>
      </div>

      {askOpen && (
        <div className="mt-3 space-y-2 rounded-[10px] border border-line bg-well/60 p-3">
          <Input
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            placeholder="Question or decision prompt (e.g., Which auth provider?)"
          />
          <Textarea
            rows={2}
            value={newOpts}
            onChange={(e) => setNewOpts(e.target.value)}
            placeholder="Comma or newline separated options (e.g., OAuth2, Session Cookie, Passkey)"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <input
                type="checkbox"
                checked={newMulti}
                onChange={(e) => setNewMulti(e.target.checked)}
                className="rounded border-line-strong"
              />
              Allow multiple choices
            </label>
            <Button
              type="button"
              size="xs"
              disabled={askMut.isPending || !newQ.trim()}
              onClick={() => askMut.mutate()}
            >
              Post to Card
            </Button>
          </div>
        </div>
      )}

      {activeQ ? (
        <div className="mt-3 rounded-[10px] border border-review/35 bg-review-tint/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
            <span className="font-semibold text-review-text">
              {activeQ.author || task.executor || "agent"} asks:
            </span>
            <span>
              {activeQ.multi_select ? "Multi-select enabled" : "Single choice or custom"}
            </span>
          </div>
          <p className="mt-1 text-[13px] font-medium leading-snug text-ink">
            {activeQ.question}
          </p>
          {activeQ.context && (
            <p className="mt-1.5 rounded bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-ink-2 border border-line/60">
              {activeQ.context}
            </p>
          )}

          {activeQ.options && activeQ.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeQ.options.map((opt) => {
                const picked = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={answerMut.isPending}
                    onClick={() => {
                      if (!activeQ.multi_select && !customAnswer.trim()) {
                        answerMut.mutate({
                          question_id: activeQ.id,
                          selected_options: [opt],
                        });
                      } else {
                        setSelected((prev) =>
                          prev.includes(opt)
                            ? prev.filter((x) => x !== opt)
                            : [...prev, opt]
                        );
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all",
                      picked
                        ? "border-accent bg-accent text-on-accent shadow-[var(--lift-1)]"
                        : "border-line-strong bg-surface text-ink hover:border-accent hover:bg-accent-tint hover:text-accent-text"
                    )}
                  >
                    {picked && <Check className="size-3" />}
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={customAnswer}
              onChange={(e) => setCustomAnswer(e.target.value)}
              placeholder="Optional custom note or free-text answer..."
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={
                answerMut.isPending ||
                (!customAnswer.trim() && selected.length === 0)
              }
              onClick={() =>
                answerMut.mutate({
                  question_id: activeQ.id,
                  selected_options: selected,
                  answer: customAnswer.trim(),
                })
              }
            >
              {task.execution_mode === "tracker"
                ? "Save Answer"
                : "Answer & Resume"}
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-ink-3">
          No pending clarification questions. Agents using{" "}
          <code className="font-mono text-[11px] text-ink-2">dsh</code>,{" "}
          <code className="font-mono text-[11px] text-ink-2">commandcode</code>, or{" "}
          <code className="font-mono text-[11px] text-ink-2">ask_task_question</code>{" "}
          will surface selectable choices here.
        </p>
      )}

      {resolved.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Answered History ({resolved.length})
          </div>
          {resolved.map((q) => (
            <div
              key={q.id}
              className="rounded-lg border border-line/80 bg-well/50 px-2.5 py-2 text-[11.5px]"
            >
              <div className="font-medium text-ink">{q.question}</div>
              <div className="mt-0.5 text-success-text">
                Answer: <span className="font-semibold">{q.answer || "(none)"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
