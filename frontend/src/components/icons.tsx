// Hugeicons (stroke rounded) is the icon set Platforms Code uses. Each export keeps the name the
// app already used, so screens import icons from here and never from the icon package directly.
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon, Alert02Icon, ArrowDown01Icon, ArrowUp01Icon, Calendar03Icon, Cancel01Icon,
  ChartDecreaseIcon, ChartIncreaseIcon, ChartLineData02Icon, CheckmarkCircle02Icon,
  CheckmarkSquare02Icon, Clock01Icon, Copy01Icon, DashboardSquare02Icon, Delete02Icon,
  Download04Icon, Flag02Icon, Folder01Icon, KanbanIcon, Key01Icon, Link01Icon, Logout03Icon,
  Menu01Icon, Message01Icon, Moon02Icon, Search01Icon, SecurityCheckIcon, Settings02Icon,
  SidebarRight01Icon, SmartPhone01Icon, Sun03Icon, TaskDaily01Icon, Tick02Icon, UserAdd01Icon, UserGroupIcon,
  ArrowDown01Icon as ChevronDownIcon, ArrowLeft01Icon, ArrowRight01Icon,
} from '@hugeicons/core-free-icons'

type IconProps = { size?: number; className?: string; strokeWidth?: number }
type IconData = Parameters<typeof HugeiconsIcon>[0]['icon']

function make(icon: IconData) {
  return function Icon({ size = 20, className, strokeWidth = 1.6 }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
  }
}

export const AlertTriangle = make(Alert02Icon)
export const ArrowDown = make(ArrowDown01Icon)
export const ArrowUp = make(ArrowUp01Icon)
export const BarChart3 = make(ChartLineData02Icon)
export const CalendarDays = make(Calendar03Icon)
export const Check = make(Tick02Icon)
export const CheckCircle2 = make(CheckmarkCircle02Icon)
export const CheckSquare = make(CheckmarkSquare02Icon)
export const ChevronDown = make(ChevronDownIcon)
export const ChevronLeft = make(ArrowLeft01Icon)
export const ChevronRight = make(ArrowRight01Icon)
export const Clock = make(Clock01Icon)
export const Copy = make(Copy01Icon)
export const Download = make(Download04Icon)
export const Flag = make(Flag02Icon)
export const FolderKanban = make(Folder01Icon)
export const KanbanSquare = make(KanbanIcon)
export const KeyRound = make(Key01Icon)
export const LayoutDashboard = make(DashboardSquare02Icon)
export const Link2 = make(Link01Icon)
export const ListTodo = make(TaskDaily01Icon)
export const LogOut = make(Logout03Icon)
export const Menu = make(Menu01Icon)
export const MessageSquare = make(Message01Icon)
export const Moon = make(Moon02Icon)
export const Plus = make(Add01Icon)
export const Search = make(Search01Icon)
export const Settings = make(Settings02Icon)
export const ShieldCheck = make(SecurityCheckIcon)
export const PanelToggle = make(SidebarRight01Icon)
export const Smartphone = make(SmartPhone01Icon)
export const Sun = make(Sun03Icon)
export const Trash2 = make(Delete02Icon)
export const TrendingDown = make(ChartDecreaseIcon)
export const TrendingUp = make(ChartIncreaseIcon)
export const UserPlus = make(UserAdd01Icon)
export const Users = make(UserGroupIcon)
export const X = make(Cancel01Icon)
