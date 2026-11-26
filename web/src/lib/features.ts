/**
 * Phase-1 feature flags.
 * Pipelines / meta7 / design-thinking are hidden from the Studio UI by default
 * until Phase 2, unless explicitly enabled via localStorage or build env.
 */
export function isPipelinesEnabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.localStorage?.getItem("switchyard.pipelines.enabled") === "1") {
      return true;
    }
  } catch {
    // ignore storage access errors in SSR/tests
  }
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  return meta.env?.VITE_ENABLE_PIPELINES === "1";
}
