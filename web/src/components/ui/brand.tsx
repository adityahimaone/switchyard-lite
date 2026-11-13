/**
 * BrandMark — "The Parallel Turnout Switch" (Kuwayama 64×64 Grid)
 *
 * Designed from scratch for Switchyard Lite (Q4: Two offset blocks with a 6-unit gap):
 *  - Lower through-track (y=38..50, h=12) in currentColor
 *  - Upper turnout branch (y=20..32 -> climbs 45deg across a 6-unit gap to y=7..19) in Royal Cobalt
 *  - Interlocking signal dot (cx=50, cy=29, r=3.5) in Prism Coral (#FF8B6A)
 *  - Below 24px (compact): swaps to a fatter 15-unit drawing with the signal dot removed.
 */
export function BrandMark({
  size = 26,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const compact = size < 24;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {compact ? (
        <>
          <rect x="6" y="37" width="52" height="15" rx="7.5" fill="currentColor" />
          <path
            d="M6 17H24C30 17 34 13 38 9H58V23H42L32 31H6V17Z"
            fill="var(--c-accent)"
          />
        </>
      ) : (
        <>
          <rect x="8" y="38" width="48" height="12" rx="6" fill="currentColor" />
          <path
            d="M8 20H24C28 20 31 18 34 15L39 10C41 8 44 7 48 7H56V19H49C47 19 45 20 43 22L38 27C35 30 31 32 26 32H8V20Z"
            fill="var(--c-accent)"
          />
          <circle cx="50" cy="29" r="3.5" fill="var(--sy-coral, #ff8b6a)" />
        </>
      )}
    </svg>
  );
}

export function BrandLockup({
  size = 26,
  suffix = "LITE",
  className,
}: {
  size?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <BrandMark size={size} />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: size * 0.68,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        Switchyard
      </span>
      {suffix && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: Math.max(9, size * 0.36),
            fontWeight: 600,
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: 999,
            background: "var(--c-accent-tint)",
            color: "var(--c-accent-text)",
            lineHeight: 1,
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
