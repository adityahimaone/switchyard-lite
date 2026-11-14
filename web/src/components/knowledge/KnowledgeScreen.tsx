import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiOr, del, post, type KnowledgeDoc } from "@/api";
import { BUILTIN_DOCS, type BuiltinDocArticle } from "@/components/knowledge/docsData";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@/components/ui/icons";
import { toast, toastError } from "@/components/ui/toast";

interface UnifiedDoc {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  badge: string;
  summary: string;
  isCustom: boolean;
  builtin?: BuiltinDocArticle;
  custom?: KnowledgeDoc;
}

function renderCustomBody(content: string) {
  const blocks = content.split(/\n```/);
  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => {
        if (idx % 2 === 1) {
          const newlineIdx = block.indexOf("\n");
          const code = newlineIdx >= 0 ? block.slice(newlineIdx + 1) : block;
          return (
            <div key={idx} className="overflow-hidden rounded-[10px] border border-line bg-well">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-mono text-ink-3">
                <span>snippet</span>
                <CopyButton value={code.trimEnd()} />
              </div>
              <pre className="m-0 overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-ink">
                <code>{code.trimEnd()}</code>
              </pre>
            </div>
          );
        }
        return block
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, pIdx) => {
            if (p.startsWith("# ")) {
              return (
                <h2 key={`${idx}-${pIdx}`} className="text-[17px] font-bold tracking-tight text-ink">
                  {p.slice(2)}
                </h2>
              );
            }
            if (p.startsWith("## ")) {
              return (
                <h3 key={`${idx}-${pIdx}`} className="text-[14.5px] font-semibold text-ink">
                  {p.slice(3)}
                </h3>
              );
            }
            return (
              <p key={`${idx}-${pIdx}`} className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
                {p}
              </p>
            );
          });
      })}
    </div>
  );
}

export function KnowledgeScreen({
  initialSlug,
  onNavigate,
}: {
  initialSlug?: string;
  onNavigate: (page: string) => void;
}) {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState(initialSlug || BUILTIN_DOCS[0].slug);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    slug: "",
    title: "",
    subtitle: "",
    category: "Custom Knowledge",
    badge: "Custom",
    summary: "",
    content: "",
  });

  useEffect(() => {
    if (initialSlug) setActiveSlug(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const customDocsQuery = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => apiOr<KnowledgeDoc[]>("/api/v1/knowledge", []),
  });

  const allDocs = useMemo<UnifiedDoc[]>(() => {
    const builtins: UnifiedDoc[] = BUILTIN_DOCS.map((d) => ({
      slug: d.slug,
      title: d.title,
      subtitle: d.subtitle,
      category: d.category,
      badge: d.badge,
      summary: d.summary,
      isCustom: false,
      builtin: d,
    }));
    const customs: UnifiedDoc[] = (customDocsQuery.data ?? []).map((c) => ({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle || "",
      category: c.category || "Custom Knowledge",
      badge: c.badge || "Custom",
      summary: c.summary || "",
      isCustom: true,
      custom: c,
    }));
    const map = new Map<string, UnifiedDoc>();
    for (const d of builtins) map.set(d.slug, d);
    for (const c of customs) map.set(c.slug, c);
    return Array.from(map.values());
  }, [customDocsQuery.data]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allDocs;
    return allDocs.filter((d) => {
      if (
        d.title.toLowerCase().includes(q) ||
        d.subtitle.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q)
      ) {
        return true;
      }
      if (d.custom?.content.toLowerCase().includes(q)) return true;
      if (
        d.builtin?.sections.some(
          (s) =>
            s.heading.toLowerCase().includes(q) ||
            s.paragraphs?.some((p) => p.toLowerCase().includes(q)) ||
            s.code?.snippet.toLowerCase().includes(q)
        )
      ) {
        return true;
      }
      return false;
    });
  }, [allDocs, query]);

  const groupedDocs = useMemo(() => {
    const map = new Map<string, UnifiedDoc[]>();
    for (const doc of filteredDocs) {
      const list = map.get(doc.category) ?? [];
      list.push(doc);
      map.set(doc.category, list);
    }
    return Array.from(map.entries());
  }, [filteredDocs]);

  const activeDoc =
    allDocs.find((d) => d.slug === activeSlug) ?? filteredDocs[0] ?? allDocs[0];
  const activeIdx = allDocs.findIndex((d) => d.slug === activeDoc?.slug);
  const prevDoc = activeIdx > 0 ? allDocs[activeIdx - 1] : undefined;
  const nextDoc =
    activeIdx >= 0 && activeIdx < allDocs.length - 1 ? allDocs[activeIdx + 1] : undefined;

  const saveMutation = useMutation({
    mutationFn: () =>
      post<KnowledgeDoc>("/api/v1/knowledge", {
        slug: draft.slug.trim() || undefined,
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        category: draft.category.trim() || "Custom Knowledge",
        badge: draft.badge.trim() || "Custom",
        summary: draft.summary.trim(),
        content: draft.content,
      }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      setEditing(false);
      if (saved?.slug) setActiveSlug(saved.slug);
      toast("Knowledge article saved", { tone: "success" });
    },
    onError: (e) => toastError(e, "Failed to save article"),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => del(`/api/v1/knowledge/${encodeURIComponent(slug)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      setEditing(false);
      setActiveSlug(BUILTIN_DOCS[0].slug);
      toast("Article deleted", { tone: "info" });
    },
    onError: (e) => toastError(e, "Failed to delete article"),
  });

  const openNewEditor = () => {
    setDraft({
      slug: "",
      title: "",
      subtitle: "",
      category: "Custom Knowledge",
      badge: "Custom",
      summary: "",
      content: "",
    });
    setEditing(true);
  };

  const openEditCustom = (c: KnowledgeDoc) => {
    setDraft({
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle || "",
      category: c.category || "Custom Knowledge",
      badge: c.badge || "Custom",
      summary: c.summary || "",
      content: c.content || "",
    });
    setEditing(true);
  };

  const selectDoc = (slug: string) => {
    setEditing(false);
    setActiveSlug(slug);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 lg:flex-row lg:items-start">
      {/* Left Navigation Sidebar */}
      <aside className="w-full shrink-0 rounded-[12px] border border-line bg-surface p-3 shadow-[var(--lift-1)] lg:sticky lg:top-4 lg:w-64">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-line">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold tracking-tight text-ink">
            <BookOpen className="size-4 text-accent" />
            <span>Knowledge</span>
          </div>
          <Button type="button" size="xs" variant="signal" onClick={openNewEditor}>
            <Plus className="size-3" />
            New doc
          </Button>
        </div>

        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs… (/)"
            className="h-8 pl-8 text-[12px]"
          />
        </div>

        <nav className="mt-3 max-h-[65vh] space-y-3 overflow-y-auto pr-0.5" aria-label="Knowledge articles">
          {groupedDocs.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] text-ink-4">No articles match "{query}".</p>
          ) : (
            groupedDocs.map(([category, docs]) => (
              <div key={category}>
                <div className="px-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
                  {category}
                </div>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {docs.map((doc) => {
                    const isActive = !editing && activeDoc?.slug === doc.slug;
                    return (
                      <li key={doc.slug}>
                        <button
                          type="button"
                          onClick={() => selectDoc(doc.slug)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] transition-colors",
                            isActive
                              ? "bg-accent-tint font-semibold text-accent-text"
                              : "text-ink-2 hover:bg-well hover:text-ink"
                          )}
                        >
                          <span className="truncate">{doc.title}</span>
                          {doc.isCustom && (
                            <span className="shrink-0 rounded bg-well px-1.5 py-0.5 font-mono text-[9.5px] text-ink-3">
                              db
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>

      {/* Center Content / Editor */}
      <main className="min-w-0 flex-1 rounded-[12px] border border-line bg-surface p-5 shadow-[var(--lift-1)] sm:p-6">
        {editing ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h1 className="m-0 text-[18px] font-bold tracking-tight text-ink">
                  {draft.slug ? "Edit Knowledge Article" : "New Knowledge Article"}
                </h1>
                <p className="m-0 mt-0.5 text-[12px] text-ink-3">
                  Stored in SQLite (`knowledge_docs`) and queryable via MCP (`list_knowledge` / `get_knowledge`).
                </p>
              </div>
              <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-2">Title *</label>
                <Input
                  required
                  value={draft.title}
                  onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., Team Deployment Playbook"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-2">Slug (optional)</label>
                <Input
                  value={draft.slug}
                  onChange={(e) => setDraft((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="auto-generated-from-title"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-2">Category</label>
                <Input
                  value={draft.category}
                  onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                  placeholder="Custom Knowledge"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-ink-2">Badge</label>
                <Input
                  value={draft.badge}
                  onChange={(e) => setDraft((p) => ({ ...p, badge: e.target.value }))}
                  placeholder="Custom"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-ink-2">Subtitle / Summary</label>
              <Input
                value={draft.summary}
                onChange={(e) => setDraft((p) => ({ ...p, summary: e.target.value }))}
                placeholder="Short executive summary shown at the top of the page"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-ink-2">Content (Markdown / Code Fences)</label>
              <Textarea
                rows={12}
                value={draft.content}
                onChange={(e) => setDraft((p) => ({ ...p, content: e.target.value }))}
                placeholder={"# Section Heading\n\nExplain conventions, MCP recipes, or runbooks...\n\n```bash\nswitchyard-lite mcp\n```"}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="signal" size="sm" loading={saveMutation.isPending}>
                Save article
              </Button>
            </div>
          </form>
        ) : activeDoc ? (
          <article className="space-y-6">
            <header className="border-b border-line pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] text-ink-3">
                  <span className="font-mono uppercase tracking-[0.08em]">{activeDoc.category}</span>
                  <Badge variant={activeDoc.isCustom ? "default" : "secondary"}>{activeDoc.badge}</Badge>
                </div>
                {activeDoc.isCustom && activeDoc.custom && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => openEditCustom(activeDoc.custom!)}
                    >
                      <Pencil className="size-3" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-danger-text hover:bg-danger-tint"
                      onClick={() => deleteMutation.mutate(activeDoc.slug)}
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>

              <h1 className="mt-2 text-[22px] font-bold tracking-[-0.025em] text-ink">
                {activeDoc.title}
              </h1>
              {activeDoc.subtitle && (
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
                  {activeDoc.subtitle}
                </p>
              )}

              {activeDoc.summary && (
                <div className="mt-4 rounded-[10px] border border-accent/25 bg-accent-tint/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                  <span className="mr-1.5 font-semibold text-accent-text">Summary:</span>
                  {activeDoc.summary}
                </div>
              )}
            </header>

            {activeDoc.builtin ? (
              <div className="space-y-6">
                {activeDoc.builtin.sections.map((sec) => (
                  <section key={sec.id} id={`doc-sec-${sec.id}`} className="scroll-mt-6 space-y-3">
                    <h2 className="text-[15.5px] font-bold tracking-tight text-ink">
                      {sec.heading}
                    </h2>

                    {sec.paragraphs?.map((p, idx) => (
                      <p key={idx} className="text-[13px] leading-relaxed text-ink-2">
                        {p}
                      </p>
                    ))}

                    {sec.bullets && (
                      <ul className="m-0 space-y-2 pl-4 text-[12.5px] leading-relaxed text-ink-2">
                        {sec.bullets.map((b) => (
                          <li key={b.label}>
                            <span className="font-semibold text-ink">{b.label}:</span>{" "}
                            <span>{b.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {sec.callout && (
                      <div
                        className={cn(
                          "rounded-[10px] border px-3.5 py-2.5 text-[12px] leading-relaxed",
                          sec.callout.tone === "warn"
                            ? "border-review/35 bg-review-tint/60 text-ink"
                            : "border-accent/25 bg-accent-tint/45 text-ink"
                        )}
                      >
                        <div className="font-semibold text-ink">{sec.callout.title}</div>
                        <div className="mt-0.5 text-ink-2">{sec.callout.body}</div>
                      </div>
                    )}

                    {sec.table && (
                      <div className="overflow-x-auto rounded-[10px] border border-line">
                        <table className="w-full border-collapse text-left text-[12px]">
                          <thead className="bg-well/80 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                            <tr>
                              {sec.table.headers.map((h) => (
                                <th key={h} className="border-b border-line px-3 py-2">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {sec.table.rows.map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-well/40">
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={cn(
                                      "px-3 py-2 align-top",
                                      cIdx === 0 ? "font-mono text-[11.5px] font-semibold text-ink" : "text-ink-2"
                                    )}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {sec.code && (
                      <div className="overflow-hidden rounded-[10px] border border-line bg-well">
                        <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-mono text-ink-3">
                          <span>{sec.code.label}</span>
                          <CopyButton value={sec.code.snippet} />
                        </div>
                        <pre className="m-0 overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-ink">
                          <code>{sec.code.snippet}</code>
                        </pre>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              activeDoc.custom && renderCustomBody(activeDoc.custom.content)
            )}

            <footer className="flex items-center justify-between gap-3 border-t border-line pt-4">
              {prevDoc ? (
                <Button type="button" variant="outline" size="xs" onClick={() => selectDoc(prevDoc.slug)}>
                  <ArrowLeft className="size-3" />
                  {prevDoc.title}
                </Button>
              ) : (
                <span />
              )}
              {nextDoc && (
                <Button type="button" variant="outline" size="xs" onClick={() => selectDoc(nextDoc.slug)}>
                  {nextDoc.title}
                  <ArrowRight className="size-3" />
                </Button>
              )}
            </footer>
          </article>
        ) : null}
      </main>

      {/* Right Table of Contents & Quick Actions */}
      <aside className="hidden w-56 shrink-0 space-y-4 xl:sticky xl:top-4 xl:block">
        {activeDoc?.builtin && (
          <div className="rounded-[12px] border border-line bg-surface p-3.5 shadow-[var(--lift-1)]">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
              On This Page
            </div>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12px]">
              {activeDoc.builtin.sections.map((sec) => (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(`doc-sec-${sec.id}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="w-full truncate text-left text-ink-3 transition-colors hover:text-ink"
                  >
                    {sec.heading}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-[12px] border border-line bg-surface p-3.5 shadow-[var(--lift-1)]">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
            Quick Actions
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <Button type="button" variant="outline" size="xs" className="justify-start" onClick={() => onNavigate("board")}>
              Open Kanban Board
            </Button>
            <Button type="button" variant="outline" size="xs" className="justify-start" onClick={() => onNavigate("pipelines")}>
              Pipelines & meta7
            </Button>
            <Button type="button" variant="outline" size="xs" className="justify-start" onClick={() => onNavigate("flow")}>
              Global Flow Map
            </Button>
            <Button type="button" variant="ghost" size="xs" className="justify-start text-accent-text" onClick={openNewEditor}>
              <Plus className="size-3" />
              Add Custom Doc
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
