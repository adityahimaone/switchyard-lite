import type { ReactNode } from "react";
import { AppSidebarToggle } from "@/components/ui/app-shell";
import { cn } from "@/lib/utils";

export interface StudioPageHeaderProps {
  title: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

/**
 * Single unified flush page header rendered at the top of every Switchyard Studio view.
 * Houses the single sidebar collapse/expand toggle so it never duplicates inside the sidebar.
 */
export function StudioPageHeader({
  title,
  count,
  leading,
  center,
  actions,
  toolbar,
  className,
}: StudioPageHeaderProps) {
  return (
    <header
      data-slot="studio-page-header"
      className={cn("shrink-0 border-b border-line bg-surface px-5 py-2.5", className)}
    >
      <div className="flex min-h-[34px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AppSidebarToggle className="-ml-1" />
          {leading}
          <div className="flex min-w-0 items-baseline gap-2.5">
            {typeof title === "string" ? (
              <h2 className="m-0 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">
                {title}
              </h2>
            ) : (
              title
            )}
            {count !== undefined && count !== null && count !== "" && (
              <span className="shrink-0 font-mono text-[12px] font-normal tabular-nums text-ink-4">
                {count}
              </span>
            )}
          </div>
        </div>

        {center && <div className="flex items-center">{center}</div>}

        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {toolbar && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/70 pt-2">
          {toolbar}
        </div>
      )}
    </header>
  );
}
