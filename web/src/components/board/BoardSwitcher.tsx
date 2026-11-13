import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import type { Board } from "@/api";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";

/**
 * Single source of truth for "which board am I looking at".
 *
 * Replaces the five hand-rolled `<select className="board-switcher">` copies
 * that used to live in App, Board, Screens (x3) and Review — every one of them
 * is now the same kanban-board style searchable picker.
 */
export function BoardSwitcher({
  boards,
  value,
  onChange,
  size = "sm",
  className,
  triggerClassName,
  ariaLabel = "Switch board",
}: {
  boards: Board[] | undefined;
  value: string | undefined;
  onChange: (boardId: string) => void;
  size?: "sm" | "default";
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const options = useMemo<SearchSelectOption[]>(
    () =>
      (boards ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        sublabel: b.id,
        icon: <LayoutGrid className="size-3.5" />,
        badge: b.default_executor || undefined,
        keywords: [b.name, b.id, b.default_executor ?? "", b.default_model ?? ""],
      })),
    [boards]
  );

  return (
    <SearchSelect
      options={options}
      value={value ?? ""}
      onValueChange={onChange}
      placeholder="Select board…"
      searchPlaceholder="Search boards…"
      emptyMessage="No boards match"
      ariaLabel={ariaLabel}
      size={size}
      showTriggerBadge
      className={className}
      triggerClassName={triggerClassName}
    />
  );
}
