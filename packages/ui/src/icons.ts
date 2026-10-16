/**
 * The one icon set for desktop and web (lucide, tree-shaken). Import icons from here — not emoji or Unicode glyphs —
 * so every icon shares one stroke weight and renders the same on every Windows font setup. Lucide marks icons
 * aria-hidden unless given an aria-label, so the surrounding button / text must carry the accessible name.
 *
 * Size with text classes: `className="h-3.5 w-3.5"` next to text-xs, `h-4 w-4` next to text-sm.
 */
export {
  ArrowDownToLine,
  ArrowUpDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Ban,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Camera,
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  ChartColumn,
  ClipboardCheck,
  Columns3,
  Clock,
  Code2,
  Contrast,
  Copy,
  CreditCard,
  Crown,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Feather,
  FileText,
  FileUp,
  FolderOpen,
  Gauge,
  GraduationCap,
  Headphones,
  HistoryIcon,
  Info,
  House,
  IndianRupee,
  KeyRound,
  Layers,
  LayoutGrid,
  Link2,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  MessagesSquare,
  Mic,
  Minus,
  Monitor,
  MoonStar,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PenLine,
  Phone,
  Pin,
  PinOff,
  Play,
  Plus,
  Power,
  QrCode as QrCodeIcon,
  RefreshCw,
  Rocket,
  Save,
  ScrollText,
  ScanText,
  Search,
  Send,
  Smartphone,
  SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Fingerprint,
  Pencil,
  Undo2,
  Redo2,
  Upload,
  UserRound,
  UserCog,
  Users,
  Volume2,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

// The web app's front door, first run and navigation (help, search, the welcome questions).
export { CircleQuestionMark, Globe, Keyboard, ListChecks, MessageCircle } from "lucide-react";

// The Contact page and the admin's Inbox.
export { Inbox, MailOpen, Reply } from "lucide-react";

// Documents: an icon per kind of document in the list.
export { File as FileIcon, NotebookPen } from "lucide-react";

// A session that heard nothing.
export { MicOff } from "lucide-react";

// The applications tracker: a job's next date to the calendar, the list to a spreadsheet.
export { CalendarPlus, Route, Sheet as SheetIcon } from "lucide-react";

// "Try this one again" on a reviewed question.
export { RotateCcw } from "lucide-react";

// The Panel round and Video interview presets.
export { UsersRound, Video } from "lucide-react";

// The answer bank (Story bank → My answers).
export { MessageSquareQuote } from "lucide-react";

// Salary practice outside India (inside it, the rupee).
export { Banknote } from "lucide-react";

// Offer AI: its mark (the rupee in India, a banknote elsewhere) and the side-by-side comparison.
export { BadgeIndianRupee, Scale } from "lucide-react";

// LinkedIn AI's mark (a profile card: lucide has no brand icons).
export { IdCard } from "lucide-react";

// Code AI's hints.
export { Lightbulb } from "lucide-react";

// The app sidebar: collapse and expand; Explore (phones).
export { Compass, PanelLeftClose, PanelLeftOpen } from "lucide-react";
