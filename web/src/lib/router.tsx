import { useEffect, useState } from "react";

export const ROUTE_CHANGE_EVENT = "switchyard:route-change";

/**
 * Returns the normalized client route without leading slashes.
 * e.g. "/board" -> "board", "/task/123" -> "task/123", "/" -> "board".
 * Also gracefully migrates any legacy hash routes (e.g. "#/board") to clean paths.
 */
export function readRoute(): string {
  if (typeof window === "undefined") return "board";

  // Backward compatibility: If the URL arrives with an old hash route like #/board or #/task/abc,
  // migrate the URL to clean path /board or /task/abc via history.replaceState.
  const hash = window.location.hash;
  if (hash && (hash.startsWith("#/") || hash.startsWith("#"))) {
    const hashTarget = hash.replace(/^#\/?/, "");
    if (hashTarget) {
      window.history.replaceState(null, "", "/" + hashTarget);
      return hashTarget;
    } else {
      window.history.replaceState(null, "", window.location.pathname || "/");
    }
  }

  const p = window.location.pathname.replace(/^\/+/, "");
  return p || "board";
}

/**
 * Navigates to a client path without page reload.
 */
export function navigate(to: string, replace = false): void {
  if (typeof window === "undefined") return;
  const target = to.startsWith("/") ? to : "/" + to;
  const current = window.location.pathname + window.location.search;
  if (current !== target) {
    if (replace) {
      window.history.replaceState(null, "", target);
    } else {
      window.history.pushState(null, "", target);
    }
  }
  window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT, { detail: target }));
}

/**
 * React hook that returns the active route and re-renders on popstate or navigate.
 */
export function useRoute(): string {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const sync = () => {
      setRoute(readRoute());
    };

    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);

    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  return route;
}

export interface LinkProps extends React.ComponentProps<"a"> {
  replace?: boolean;
}

/**
 * Declarative link component that uses HTML5 history pushState for internal paths.
 */
export function Link({ href, replace = false, onClick, target, children, ...props }: LinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (
      !e.defaultPrevented &&
      href &&
      href.startsWith("/") &&
      !target &&
      e.button === 0 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      navigate(href, replace);
    }
  };

  return (
    <a href={href} target={target} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
