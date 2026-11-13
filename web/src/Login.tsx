import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  GitBranch,
  GitPullRequest,
  KeyRound,
  Lock,
  ShieldCheck,
} from "@/components/ui/icons";
import { api, apiOr, post, setToken } from "./api";
import { ErrorBox } from "./ui";
import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "password" | "token";

const FEATURES = [
  {
    icon: GitBranch,
    title: "Worktree isolation",
    body: "Every task runs on its own sy/<task-id> branch, created from the base you pick.",
  },
  {
    icon: GitPullRequest,
    title: "Review gate",
    body: "Diffs, commits and merge decisions stay behind an explicit approve step.",
  },
  {
    icon: Activity,
    title: "Live worker map",
    body: "See which node, executor and stage is handling each task in real time.",
  },
];

export function Login({ onDone }: { onDone: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [source, setSource] = useState<string>("none");
  const [mode, setMode] = useState<Mode>("password");
  const [pw, setPw] = useState("");
  const [tok, setTok] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();

  useEffect(() => {
    apiOr<{ login_enabled: boolean; password_source?: string }>("/api/v1/session", {
      login_enabled: false,
    }).then(
      (r) => {
        setEnabled(r.login_enabled);
        setSource(r.password_source ?? (r.login_enabled ? "env" : "none"));
        if (!r.login_enabled) setMode("token");
      },
      () => {
        setEnabled(false);
        setMode("token");
      }
    );
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setBusy(true);
    try {
      const r = await post<{ token: string }>("/api/v1/session", { password: pw });
      setToken(r.token);
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  }

  async function useToken(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    const value = tok.trim();
    if (!value) {
      setErr(new Error("Paste an API token first."));
      return;
    }
    setBusy(true);
    setToken(value);
    try {
      await api("/api/v1/boards");
      onDone();
    } catch (x) {
      setToken("");
      setErr(x);
    } finally {
      setBusy(false);
    }
  }

  const passwordDisabled = enabled === false;

  return (
    <main className="login-stage">
      <div className="login-frame">
        {/* ------------------------------------------------------------ hero */}
        <section className="login-hero" aria-label="About Switchyard Lite">
          <span className="inline-flex items-center gap-2 rounded-full border border-line/70 bg-surface/55 px-3 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase backdrop-blur-md">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            Control plane online
          </span>

          <h1 className="mt-5 max-w-[18ch] text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-ink sm:text-[40px]">
            Ship agent work,
            <br />
            not agent chaos.
          </h1>
          <p className="mt-3 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
            Dispatch coding agents onto real repositories, isolate every run in a worktree, and keep the
            final diff behind a human review gate.
          </p>

          <ul className="mt-7 grid max-w-[46ch] gap-3">
            {FEATURES.map((f) => (
              <li
                key={f.title}
                className="flex items-start gap-3 rounded-[16px] border border-line/60 bg-surface/45 px-3.5 py-3 backdrop-blur-md"
              >
                <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line/70 bg-well/70 text-ink-2">
                  <f.icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink">{f.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------------ card */}
        <div className="login-glass login-rise rounded-[30px] p-2.5">
          <div className="rounded-[23px] border border-line/80 bg-surface/82 p-5 backdrop-blur-xl sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="brand-mark-tile" aria-hidden>
                  <BrandMark size={24} />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[13px] leading-tight font-semibold text-ink">Switchyard Lite</p>
                  <p className="m-0 font-mono text-[9.5px] tracking-[0.1em] text-ink-4 uppercase">
                    Control plane access
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-line/70 bg-well/60 px-2 py-1 font-mono text-[9px] text-ink-3">
                <ShieldCheck className="size-2.5" />
                admin
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Sign-in method"
              className="mt-5 flex items-center gap-1 rounded-full border border-line/80 bg-well/70 p-1 shadow-[var(--well-inset)]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "password"}
                className="login-tab"
                onClick={() => {
                  setMode("password");
                  setErr(undefined);
                }}
              >
                <Lock className="size-3" />
                Password
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "token"}
                className="login-tab"
                onClick={() => {
                  setMode("token");
                  setErr(undefined);
                }}
              >
                <KeyRound className="size-3" />
                API token
              </button>
            </div>

            <div className="mt-4">
              <ErrorBox error={err} />
            </div>

            {passwordDisabled && (
              <p className="m-0 mt-3 rounded-[14px] border border-warning/35 bg-warning-tint/60 px-3 py-2.5 text-[11px] leading-relaxed text-warning-text">
                Password login is disabled on this server. Use an API token, or sign in with an admin token
                and set a password from Settings → Password &amp; access.
              </p>
            )}

            {mode === "password" ? (
              <form onSubmit={login} className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login-password" className="text-[11px] font-medium text-ink-2">
                    <Lock className="size-3 text-ink-3" />
                    Admin password
                    {source === "stored" && (
                      <span className="ml-auto font-mono text-[9px] font-normal text-ink-4">stored</span>
                    )}
                    {source === "env" && (
                      <span className="ml-auto font-mono text-[9px] font-normal text-ink-4">server env</span>
                    )}
                  </Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPw ? "text" : "password"}
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      autoFocus
                      autoComplete="current-password"
                      disabled={passwordDisabled || busy}
                      placeholder={passwordDisabled ? "Password login disabled" : "Enter admin password…"}
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      disabled={passwordDisabled}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-well hover:text-ink disabled:opacity-40"
                    >
                      {showPw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="signal"
                  size="lg"
                  className="w-full justify-center"
                  disabled={passwordDisabled || busy || pw.length === 0}
                >
                  {busy ? "Signing in…" : "Sign in"}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>

                <p className="m-0 text-center text-[10px] leading-relaxed text-ink-4">
                  Change this password later from Settings → Password &amp; access.
                </p>
              </form>
            ) : (
              <form onSubmit={useToken} className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login-token" className="text-[11px] font-medium text-ink-2">
                    <KeyRound className="size-3 text-ink-3" />
                    API token
                  </Label>
                  <Input
                    id="login-token"
                    value={tok}
                    onChange={(e) => setTok(e.target.value)}
                    autoFocus={passwordDisabled}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="syl_…"
                    className="h-10 font-mono text-[11px]"
                  />
                </div>

                <Button
                  type="submit"
                  variant="obsidian"
                  size="lg"
                  className="w-full justify-center"
                  disabled={busy || tok.trim().length === 0}
                >
                  {busy ? "Checking token…" : "Use token"}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>

                <p className="m-0 rounded-[12px] border border-line/70 bg-well/55 px-3 py-2 text-[10px] leading-relaxed text-ink-4">
                  Tokens are <span className="font-medium text-ink-3">not required</span> if you know the admin
                  password. Create scoped tokens in Settings → API tokens after signing in; a{" "}
                  <span className="font-mono text-ink-3">read</span> token can browse, a{" "}
                  <span className="font-mono text-ink-3">write</span> token can dispatch.
                </p>
              </form>
            )}

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-line/70 pt-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-4">
                <span className={cn("size-1.5 rounded-full", enabled ? "bg-success" : "bg-line-strong")} />
                {enabled ? "Password login available" : "Token access only"}
              </span>
              <span className="font-mono text-[9px] tracking-[0.08em] text-ink-4 uppercase">switchyard-lite</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
