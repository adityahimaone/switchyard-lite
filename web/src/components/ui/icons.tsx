/**
 * Switchyard Studio icon set.
 *
 * Icons are divided into two categories:
 * 1. Default UI primitives (Arrow, dropdown Menu, X/Close, Edit) from `lucide-react`
 *    for standard, crisp, neutral UI controls.
 * 2. Domain & semantic icons backed by `kubai-icons-react` with contextual tones.
 *
 * Every export preserves its existing name and accepts standard `className="size-*"` sizing.
 */
import * as React from "react";
import * as K from "kubai-icons-react";
import type { KubaiIconComponent, KubaiIconProps } from "kubai-icons-react";
import {
  Apple,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  ChevronsUpDown,
  Database,
  Edit,
  Edit2,
  Edit3,
  Expand,
  GripVertical,
  HelpCircle,
  Menu,
  Minimize2,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

function make(name: string, Icon: KubaiIconComponent, tone?: string): KubaiIconComponent {
  const Wrapped = React.forwardRef<SVGSVGElement, KubaiIconProps>(function KubaiIcon(
    { color, trigger, ...rest },
    ref
  ) {
    return <Icon ref={ref} color={color ?? tone} trigger={trigger ?? "parent"} {...rest} />;
  });
  Wrapped.displayName = name;
  return Wrapped as KubaiIconComponent;
}

// -----------------------------------------------------------------------------
// Default standard UI primitives (lucide-react)
// (Arrow, dropdown Menu, X/Close, Edit)
// -----------------------------------------------------------------------------
export {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  ChevronsUpDown,
  Edit,
  Edit2,
  Edit3,
  Menu,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  X,
};

// Aliases matching existing usages in the app
export const ChevronDownIcon = ChevronDown;
export const ChevronUpIcon = ChevronUp;
export const XIcon = X;
export const Close = X;

// -----------------------------------------------------------------------------
// Domain & semantic Kubai-backed icons
// -----------------------------------------------------------------------------
export const Activity = make("Activity", K.Activity, "#EC4899");
export const AtSign = make("AtSign", K.AtSign, "#8B5CF6");
export const BookOpen = make("BookOpen", K.BookOpen, "#8B5CF6");
export const AlertCircle = make("AlertCircle", K.CircleAlert, "#F59E0B");
export const Check = make("Check", K.CircleCheck, "#16A34A");
export const CheckCircle2 = make("CheckCircle2", K.CircleCheck, "#16A34A");
export const CheckIcon = make("CheckIcon", K.CircleCheck, "#16A34A");
export const CircleDot = make("CircleDot", K.CircleDot, "#2F5BFF");
export const Plus = make("Plus", K.CirclePlus, "#2F5BFF");
export const CloudDownload = make("CloudDownload", K.CloudDown, "#06B6D4");
export const CloudUpload = make("CloudUpload", K.CloudUpload, "#06B6D4");
export const Columns3 = make("Columns3", K.Columns, "#64748B");
export const Copy = make("Copy", K.Copy, "#64748B");
export const Cpu = make("Cpu", K.Cpu, "#EF4444");
export const ExternalLink = make("ExternalLink", K.ExternalLink, "#2F5BFF");
export const Eye = make("Eye", K.Eye, "#64748B");
export const EyeOff = make("EyeOff", K.EyeOff, "#64748B");
export const FileCode2 = make("FileCode2", K.FileCode, "#2F5BFF");
export const FileSearch = make("FileSearch", K.FileSearch, "#06B6D4");
export const Filter = make("Filter", K.Filter, "#64748B");
export const FolderGit2 = make("FolderGit2", K.Folder, "#F59E0B");
export const GitBranch = make("GitBranch", K.GitBranch, "#F97316");
export const GitPullRequest = make("GitPullRequest", K.GitPullRequest, "#16A34A");
export const LayoutGrid = make("LayoutGrid", K.Grid, "#64748B");
export const HardDrive = make("HardDrive", K.HardDrive, "#64748B");
export const Hash = make("Hash", K.Hash, "#64748B");
export const History = make("History", K.History, "#64748B");
export const Inbox = make("Inbox", K.Inbox, "#64748B");
export const Info = make("Info", K.Info, "#2F5BFF");
export const Kanban = make("Kanban", K.Kanban, "#2F5BFF");
export const KeyRound = make("KeyRound", K.KeyRound, "#F59E0B");
export const Laptop = make("Laptop", K.Laptop, "#64748B");
export const Layers = make("Layers", K.Layers, "#8B5CF6");
export const Link2 = make("Link2", K.Link2, "#64748B");
export const ListTodo = make("ListTodo", K.ListChecks, "#16A34A");
export const Loader2 = make("Loader2", K.Loader, "#64748B");
export const Lock = make("Lock", K.Lock, "#F59E0B");
export const Maximize2 = make("Maximize2", K.Maximize, "#64748B");
export const MessageSquare = make("MessageSquare", K.MessageSquare, "#06B6D4");
export const Monitor = make("Monitor", K.Monitor, "#64748B");
export const Network = make("Network", K.Network, "#06B6D4");
export const Palette = make("Palette", K.Palette, "#EC4899");
export const Paperclip = make("Paperclip", K.Paperclip, "#F59E0B");
export const Play = make("Play", K.Play, "#16A34A");
export const Radio = make("Radio", K.Radio, "#EF4444");
export const RotateCcw = make("RotateCcw", K.RotateCcw, "#64748B");
export const RefreshCw = make("RefreshCw", K.RotateCw, "#06B6D4");
export const ScrollText = make("ScrollText", K.Scroll, "#14B8A6");
export const Search = make("Search", K.Search, "#64748B");
export const Send = make("Send", K.Send, "#2F5BFF");
export const Server = make("Server", K.Server, "#64748B");
export const Settings2 = make("Settings2", K.Settings, "#64748B");
export const ShieldAlert = make("ShieldAlert", K.ShieldAlert, "#F59E0B");
export const ShieldCheck = make("ShieldCheck", K.ShieldCheck, "#16A34A");
export const PanelLeft = make("PanelLeft", K.Sidebar, "#64748B");
export const PanelLeftClose = make("PanelLeftClose", K.Sidebar, "#64748B");
export const SlidersHorizontal = make("SlidersHorizontal", K.Sliders, "#64748B");
export const Sparkles = make("Sparkles", K.Sparkles, "#8B5CF6");
export const SunMoon = make("SunMoon", K.Sun, "#F59E0B");
export const Table2 = make("Table2", K.Table, "#64748B");
export const Terminal = make("Terminal", K.Terminal, "#64748B");
export const Trash2 = make("Trash2", K.Trash, "#EF4444");
export const AlertTriangle = make("AlertTriangle", K.TriangleAlert, "#F59E0B");
export const Workflow = make("Workflow", K.Workflow, "#8B5CF6");

// Brand & flow controls from lucide
export { Apple, Brain, Database, Expand, GripVertical, HelpCircle, Minimize2, ZoomIn, ZoomOut };
