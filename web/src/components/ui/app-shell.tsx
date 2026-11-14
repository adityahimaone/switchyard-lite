import * as React from "react";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";
import { Tip } from "./tooltip";

/**
 * Switchyard Lite App / Dashboard Shell
 *
 * Implements the Floating Left Capsule Sidebar Dock + Double-Framed Porcelain Stage:
 *   - `AppShell`: Root 2-column viewport grid (`244px` expanded / `68px` collapsed) over soft cloud sky.
 *   - `AppSidebar`: Floating left sidebar dock (`rounded-[26px]`) housing `.side-top-pod` (`AppSidebarBrand` +
 *     board switcher + quick task button), `AppSidebarTrack`, `AppSidebarGroup` cards, `AppSidebarItem`
 *     (elevated porcelain pill on active route), and `AppSidebarFooter`.
 *   - `AppInset`: Double-framed porcelain bezel (`rounded-[26px]` well) enclosing `AppHeader` (stage ribbon)
 *     and `AppMain` (scrollable or full-bleed workspace stage).
 */
interface AppShellContextValue {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

const AppShellContext = React.createContext<AppShellContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useAppShell() {
  return React.useContext(AppShellContext);
}

export interface AppShellProps extends React.ComponentProps<"div"> {
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function AppShell({
  collapsed: controlledCollapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  className,
  children,
  ...props
}: AppShellProps) {
  const [internalCollapsed, setInternalCollapsed] =
    React.useState(defaultCollapsed);
  const isControlled = controlledCollapsed !== undefined;
  const collapsed = isControlled ? controlledCollapsed : internalCollapsed;

  // 收起/展开的 200ms 里，侧栏与舞台每帧都在改变尺寸，而两者的
  // backdrop-filter 会跟着逐帧重采样背景（这是真正吃 GPU 的部分）。
  // 只在过渡窗口内降级为实色，视觉上几乎无差，掉帧消失。
  const [animating, setAnimating] = React.useState(false);
  const animTimer = React.useRef<number | undefined>(undefined);
  const didMount = React.useRef(false);
  React.useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setAnimating(true);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), 240);
    return () => window.clearTimeout(animTimer.current);
  }, [collapsed]);

  const setCollapsed = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(collapsed) : updater;
      if (!isControlled) setInternalCollapsed(next);
      onCollapsedChange?.(next);
    },
    [collapsed, isControlled, onCollapsedChange]
  );

  return (
    <AppShellContext.Provider value={{ collapsed, setCollapsed }}>
      <div
        data-slot="app-shell"
        data-collapsed={collapsed || undefined}
        data-animating={animating || undefined}
        className={cn("shell", collapsed && "collapsed", className)}
        {...props}
      >
        {children}
      </div>
    </AppShellContext.Provider>
  );
}

export function AppSidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="app-sidebar"
      aria-label="Main"
      className={cn("side", className)}
      {...props}
    >
      {children}
    </nav>
  );
}

export interface AppSidebarBrandProps extends React.ComponentProps<"div"> {
  name?: string;
  tag?: string;
  markSize?: number;
}

export function AppSidebarBrand({
  name = "Switchyard",
  tag = "LITE",
  markSize = 26,
  className,
  children,
  ...props
}: AppSidebarBrandProps) {
  const { collapsed } = useAppShell();

  const brandEl = (
    <div
      data-slot="app-sidebar-brand"
      className={cn("side-brand", className)}
      {...props}
    >
      {children ?? (
        <>
          <span className="brand-mark-tile" aria-hidden>
            <BrandMark size={markSize} />
          </span>
          <h1>
            <span>{name}</span>
            {tag && <span className="lite-badge">{tag}</span>}
          </h1>
        </>
      )}
    </div>
  );

  // Always mounted, tooltip只挂载在 collapsed 态：切换时 DOM 形状不变，
  // 侧栏内的 nav 项不会在展开/收起动画中途重挂载。
  return (
    <Tip
      side="right"
      delayDuration={80}
      label={`${name} ${tag}`.trim()}
      disabled={!collapsed}
    >
      {brandEl}
    </Tip>
  );
}

export interface AppSidebarGroupProps extends React.ComponentProps<"div"> {
  label?: string;
}

export function AppSidebarTrack({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-sidebar-track"
      className={cn("nav-deck-track", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AppSidebarGroup({
  label,
  className,
  children,
  ...props
}: AppSidebarGroupProps) {
  return (
    <div
      data-slot="app-sidebar-group"
      className={cn("nav-group", className)}
      {...props}
    >
      {label && <span className="nav-group-label">{label}</span>}
      {children}
    </div>
  );
}

export interface AppSidebarItemProps extends React.ComponentProps<"a"> {
  active?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export function AppSidebarItem({
  active = false,
  icon,
  badge,
  className,
  children,
  ...props
}: AppSidebarItemProps) {
  const { collapsed } = useAppShell();

  const item = (
    <a
      data-slot="app-sidebar-item"
      data-kubai-trigger
      aria-current={active ? "page" : undefined}
      className={cn("nav-item", className)}
      {...props}
    >
      {icon && (
        <span className="nav-icon-wrap" aria-hidden>
          {icon}
        </span>
      )}
      <span className="nav-label">{children}</span>
      {badge !== undefined && badge !== null && badge !== false && (
        <span className="nav-badge tabular">{badge}</span>
      )}
    </a>
  );

  const tipLabel = (
    <span className="flex items-center gap-2 font-medium">
      <span>{children}</span>
      {badge !== undefined && badge !== null && badge !== false && (
        <span className="nav-badge tabular">{badge}</span>
      )}
    </span>
  );

  // 同上：始终保留 Tip 外壳，展开态只停用 popup。
  return (
    <Tip side="right" delayDuration={80} label={tipLabel} disabled={!collapsed}>
      {item}
    </Tip>
  );
}

export function AppSidebarFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-sidebar-footer"
      className={cn("side-footer", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AppInset({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-inset"
      className={cn("shell-inset", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AppHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn("top-header", className)}
      {...props}
    >
      {children}
    </header>
  );
}

export interface AppMainProps extends React.ComponentProps<"main"> {
  bleed?: boolean;
}

export function AppMain({
  bleed = false,
  className,
  children,
  ...props
}: AppMainProps) {
  return (
    <main
      data-slot="app-main"
      className={cn(bleed && "bleed", className)}
      {...props}
    >
      {children}
    </main>
  );
}
