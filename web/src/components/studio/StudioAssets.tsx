import { cn } from "@/lib/utils";
import type { Board } from "@/api";

export const BOARD_EMOJI_PRESETS = [
  "⚡",
  "🚀",
  "🧭",
  "🛠️",
  "📦",
  "🎨",
  "🧠",
  "🔬",
  "🛡️",
  "🌊",
  "🔥",
  "✨",
] as const;

const BOARD_TINTS = [
  "bg-violet-100/90 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100",
  "bg-sky-100/90 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100",
  "bg-amber-100/90 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  "bg-emerald-100/90 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
  "bg-rose-100/90 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100",
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function boardEmoji(board?: Pick<Board, "id" | "name" | "emoji"> | null): string {
  const custom = board?.emoji?.trim();
  if (custom) return custom;
  const seed = board?.id || board?.name || "main";
  return BOARD_EMOJI_PRESETS[hashStr(seed) % BOARD_EMOJI_PRESETS.length];
}

export function BoardEmojiTile({
  board,
  emoji,
  size = 32,
  className,
}: {
  board?: Pick<Board, "id" | "name" | "emoji"> | null;
  emoji?: string;
  size?: number;
  className?: string;
}) {
  const glyph = emoji?.trim() || boardEmoji(board);
  const tintIdx = hashStr(board?.id || board?.name || glyph) % BOARD_TINTS.length;
  const fontSize = Math.max(11, Math.round(size * 0.56));
  return (
    <span
      aria-hidden
      data-testid="board-emoji-tile"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-[9px] border border-black/5 dark:border-white/10",
        BOARD_TINTS[tintIdx],
        className
      )}
      style={{ width: size, height: size, fontSize, lineHeight: 1 }}
    >
      {glyph}
    </span>
  );
}

/**
 * Cohesive pastel illustrated avatars inspired by the Warm Light Tactile Studio shell.
 * Uses the generated 3D clay artwork for DSH and matching pastel character SVGs for AGY, CMD, and Studio.
 */
export function HarnessAvatar({
  harness,
  size = 28,
  className,
}: {
  harness?: string;
  size?: number;
  className?: string;
}) {
  const key = (harness || "studio").toLowerCase();
  const baseCls = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-black/5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    className
  );

  if (key.includes("dsh")) {
    return (
      <span className={baseCls} style={{ width: size, height: size, background: "#BAE6FD" }}>
        <img
          src="/studio/avatar-dsh.jpg"
          alt="DSH harness avatar"
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }

  if (key.includes("agy") || key.includes("antigravity")) {
    return (
      <span className={baseCls} style={{ width: size, height: size, background: "#DDD6FE" }} aria-hidden>
        <svg viewBox="0 0 36 36" className="h-full w-full">
          <rect width="36" height="36" fill="#DDD6FE" />
          <circle cx="18" cy="14.5" r="6.5" fill="#FDE7D9" />
          <path d="M11.5 14c.8-4.8 4-7 6.5-7s5.7 2.2 6.5 7c-1.5-2.2-3.7-3-6.5-3s-5 .8-6.5 3z" fill="#312E81" />
          <rect x="13" y="13.2" width="4.2" height="2.8" rx="1.2" fill="none" stroke="#1E1B4B" strokeWidth="1.2" />
          <rect x="18.8" y="13.2" width="4.2" height="2.8" rx="1.2" fill="none" stroke="#1E1B4B" strokeWidth="1.2" />
          <line x1="17.2" y1="14.6" x2="18.8" y2="14.6" stroke="#1E1B4B" strokeWidth="1.2" />
          <path d="M15.8 18.2c1.2 1 3.2 1 4.4 0" fill="none" stroke="#9A3412" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9 32c1-5.8 4.4-8.5 9-8.5s8 2.7 9 8.5" fill="#4F46E5" />
        </svg>
      </span>
    );
  }

  if (key.includes("cmd") || key.includes("commandcode")) {
    return (
      <span className={baseCls} style={{ width: size, height: size, background: "#FEF08A" }} aria-hidden>
        <svg viewBox="0 0 36 36" className="h-full w-full">
          <rect width="36" height="36" fill="#FEF08A" />
          <circle cx="18" cy="15.5" r="6.5" fill="#FDE6D2" />
          <path d="M11 13c1-4.8 3.6-6.8 7-6.8s6 2 7 6.8z" fill="#D97706" />
          <circle cx="15.5" cy="15.2" r="1.1" fill="#1F2937" />
          <circle cx="20.5" cy="15.2" r="1.1" fill="#1F2937" />
          <path d="M15.8 18.7c1.2 1 3.2 1 4.4 0" fill="none" stroke="#9A3412" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9 32c1-5.8 4.4-8.5 9-8.5s8 2.7 9 8.5" fill="#0F172A" />
        </svg>
      </span>
    );
  }

  return (
    <span className={baseCls} style={{ width: size, height: size, background: "#CCFBF1" }} aria-hidden>
      <svg viewBox="0 0 36 36" className="h-full w-full">
        <rect width="36" height="36" fill="#CCFBF1" />
        <circle cx="18" cy="15" r="6.5" fill="#FDE7D9" />
        <path d="M11.5 14.5c.8-4.8 3.6-7 6.5-7 3.4 0 6 2.5 6.5 7-1.6-2.4-3.7-3.4-6.5-3.4-2.5 0-4.6 1-6.5 3.4z" fill="#0F172A" />
        <circle cx="15.5" cy="15" r="1.1" fill="#0F172A" />
        <circle cx="20.5" cy="15" r="1.1" fill="#0F172A" />
        <path d="M15.8 18.2c1.2 1 3.2 1 4.4 0" fill="none" stroke="#9A3412" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M9 32c1-5.8 4.4-8.5 9-8.5s8 2.7 9 8.5" fill="#0EA5E9" />
      </svg>
    </span>
  );
}

export function EmptyHorizonArt({ className }: { className?: string }) {
  return (
    <img
      src="/studio/empty-horizon.jpg"
      alt=""
      aria-hidden
      className={cn("h-24 w-40 rounded-xl object-cover opacity-90 shadow-xs", className)}
      loading="lazy"
    />
  );
}
