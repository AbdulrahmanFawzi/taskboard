export type Role = 'Viewer' | 'Member' | 'Admin' | 'Owner'
export type ColumnKind = 'Todo' | 'InProgress' | 'Review' | 'Done'
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent'

export const roleRank: Record<Role, number> = { Viewer: 0, Member: 1, Admin: 2, Owner: 3 }
export const priorities: Priority[] = ['Low', 'Medium', 'High', 'Urgent']

export interface Me {
  id: string
  email: string
  displayName: string
  avatarColor: string
  twoFactorEnabled: boolean
  twoFactorRequired: boolean
  sessionVerified: boolean
  recoveryCodesLeft: number
}

export interface LoginResponse { requiresTwoFactor: boolean; user: Me | null }
export interface TwoFactorSetup { sharedKey: string; authenticatorUri: string }

export interface WorkspaceSummary { id: string; name: string; accentColor: string; role: Role; memberCount: number }
export interface Column { id: string; name: string; kind: ColumnKind; position: number }
export interface Project { id: string; name: string; color: string }
export interface Member { userId: string; displayName: string; email: string; avatarColor: string; role: Role; joinedAt: string }
export interface Workspace {
  id: string
  name: string
  accentColor: string
  myRole: Role
  columns: Column[]
  projects: Project[]
  members: Member[]
}

export interface Task {
  id: string
  columnId: string
  projectId: string | null
  title: string
  description: string
  tag: string | null
  priority: Priority
  dueDate: string | null
  position: number
  trackedMinutes: number
  assigneeIds: string[]
  checklistTotal: number
  checklistDone: number
  commentCount: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ChecklistItem { id: string; text: string; done: boolean; position: number }
export interface Comment { id: string; authorId: string; authorName: string; authorColor: string; body: string; createdAt: string }
export interface TaskDetail { task: Task; checklist: ChecklistItem[]; comments: Comment[] }

export interface Invitation { id: string; email: string; role: Role; token: string; expiresAt: string; createdAt: string }
export interface InvitationPreview { workspaceName: string; email: string; role: Role; expired: boolean; accepted: boolean }

export interface DayCount { date: string; count: number }
export interface Activity {
  id: string; type: string; summary: string; actorId: string; actorName: string; actorColor: string
  taskId: string | null; createdAt: string
}
export interface Dashboard {
  totalProjects: number
  activeTasks: number
  completedThisWeek: number
  overdue: number
  dueToday: number
  thisWeek: DayCount[]
  lastWeekTotal: number
  projects: { id: string; name: string; color: string; total: number; done: number }[]
  myTasks: Task[]
  recentActivity: Activity[]
}

export interface Metric { value: number; previous: number; spark: number[] }
export interface Analytics {
  rangeDays: number
  tasksCompleted: Metric
  hoursTracked: Metric
  onTimeRate: Metric
  avgCycleDays: Metric
  throughput: { date: string; current: number; previous: number }[]
  timeByProject: { id: string | null; name: string; color: string; hours: number }[]
  heatmap: DayCount[]
  topContributors: { userId: string; displayName: string; avatarColor: string; completed: number; hours: number }[]
  byStatus: { columnId: string; name: string; kind: ColumnKind; count: number }[]
  byPriority: { priority: Priority; count: number }[]
}
