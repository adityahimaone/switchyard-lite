/**
 * Kubai-backed icon set.
 *
 * Exports the same names the app previously imported from lucide-react, so
 * call sites keep their `className="size-*"` sizing and `currentColor`
 * inheritance. Sizing works because Kubai renders width/height attributes
 * while the size utility sets CSS width/height, which wins.
 *
 * Two intentional exceptions:
 *   - `Apple` stays lucide: Kubai's "apple" is the fruit, not the macOS mark.
 *   - `SunMoon` maps to `Sun`: Kubai has no combined sun/moon glyph.
 *   - `PanelLeftClose` maps to `Sidebar`: Kubai has no "sidebar close" variant.
 */
export {
  Activity,
  ArrowLeft,
  ArrowRight,
  AtSign,
  ChevronDown,
  ChevronDown as ChevronDownIcon,
  ChevronRight,
  ChevronUp,
  ChevronUp as ChevronUpIcon,
  ChevronsUp as ChevronsUpDown,
  CircleAlert as AlertCircle,
  CircleCheck as Check,
  CircleCheck as CheckCircle2,
  CircleCheck as CheckIcon,
  CircleDot,
  CirclePlus as Plus,
  CircleX as X,
  CircleX as XIcon,
  CloudDown as CloudDownload,
  CloudUpload,
  Columns as Columns3,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode as FileCode2,
  FileSearch,
  Filter,
  Folder as FolderGit2,
  GitBranch,
  GitPullRequest,
  Grid as LayoutGrid,
  HardDrive,
  Hash,
  History,
  Inbox,
  Info,
  Kanban,
  KeyRound,
  Laptop,
  Layers,
  Link2,
  ListChecks as ListTodo,
  Loader as Loader2,
  Lock,
  Maximize as Maximize2,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Network,
  Palette,
  Paperclip,
  Pencil,
  Play,
  Radio,
  RotateCcw,
  RotateCw as RefreshCw,
  Scroll as ScrollText,
  Search,
  Send,
  Server,
  Settings as Settings2,
  ShieldAlert,
  ShieldCheck,
  Sidebar as PanelLeft,
  Sidebar as PanelLeftClose,
  Sliders as SlidersHorizontal,
  Sparkles,
  Sun as SunMoon,
  Table as Table2,
  Terminal,
  Trash as Trash2,
  TriangleAlert as AlertTriangle,
  Workflow,
} from "kubai-icons-react";

/** Kubai's "apple" is the fruit; keep the macOS brand mark from lucide. */
export { Apple } from "lucide-react";
