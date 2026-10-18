import { memo, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, CheckSquare, Flag, MessageSquare, Plus, Search } from '../components/icons'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { keys, useCan, useTasks, useWorkspace, useWorkspaceId } from '../lib/workspace'
import type { Column, Member, Project, Task, Workspace } from '../lib/types'
import { Avatar, Badge, Button, PageLoader, priorityColor, useToast } from '../components/ui'
import { TaskModal } from '../components/TaskModal'
import { count, LOCALE, priorityLabel, shortDate } from '../lib/i18n'

type Filter = 'all' | 'mine' | 'high' | 'week'
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'الكل' }, { id: 'mine', label: 'مهامي' }, { id: 'high', label: 'أولوية عالية' }, { id: 'week', label: 'تستحق هذا الأسبوع' },
]

export const kindColor: Record<string, string> = { Todo: '#94a3b8', InProgress: '#f59e0b', Review: '#8b5cf6', Done: 'var(--ok)' }

export function BoardPage() {
  const workspaceId = useWorkspaceId()
  const { data: ws } = useWorkspace()
  const { data: tasks } = useTasks()
  const { me } = useAuth()
  const canEdit = useCan('Member')
  const qc = useQueryClient()
  const { toast, toastNode } = useToast()

  const [filter, setFilter] = useState<Filter>('all')
  const [projectId, setProjectId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  /** While dragging, the board renders this order instead of the server's. */
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null)
  const dragOrigin = useRef<string | null>(null)

  const visible = useMemo(() => {
    if (!tasks) return []
    const q = query.trim().toLowerCase()
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
    return tasks.filter(t =>
      (filter !== 'mine' || (me && t.assigneeIds.includes(me.id))) &&
      (filter !== 'high' || t.priority === 'High' || t.priority === 'Urgent') &&
      (filter !== 'week' || (t.dueDate && !t.completedAt && new Date(t.dueDate) <= weekEnd)) &&
      (!projectId || t.projectId === projectId) &&
      (!q || t.title.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q)))
  }, [tasks, filter, projectId, query, me])

  const serverItems = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const c of ws?.columns ?? []) map[c.id] = []
    for (const t of [...visible].sort((a, b) => a.position - b.position)) map[t.columnId]?.push(t.id)
    return map
  }, [visible, ws])
  const items = dragItems ?? serverItems
  const byId = useMemo(() => new Map(tasks?.map(t => [t.id, t])), [tasks])

  const move = useMutation({
    mutationFn: (v: { taskId: string; columnId: string; index: number }) =>
      api.post<Task[]>(`/api/tasks/${v.taskId}/move`, { columnId: v.columnId, index: v.index }),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: keys.tasks(workspaceId) })
      const before = qc.getQueryData<Task[]>(keys.tasks(workspaceId))
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old && reorder(old, v.taskId, v.columnId, v.index, ws!))
      return { before }
    },
    onSuccess: changed => {
      const map = new Map(changed.map(t => [t.id, t]))
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old?.map(t => map.get(t.id) ?? t))
      qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.tasks(workspaceId), ctx.before)
      toast(e instanceof Error ? e.message : 'تعذّر نقل البطاقة')
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!ws || !tasks) return <PageLoader />

  const containerOf = (id: string, map = items) => (id in map ? id : Object.keys(map).find(k => map[k]!.includes(id)))

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
    dragOrigin.current = containerOf(String(active.id)) ?? null
    setDragItems(serverItems)
  }

  // Moving between columns happens live while hovering, so the gap opens where the card will land.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return
    const from = containerOf(String(active.id), dragItems)
    const to = containerOf(String(over.id), dragItems)
    if (!from || !to || from === to) return
    setDragItems(prev => {
      if (!prev) return prev
      const source = prev[from]!.filter(id => id !== active.id)
      const target = [...prev[to]!]
      const overIndex = target.indexOf(String(over.id))
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id))
      return { ...prev, [from]: source, [to]: target }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const current = dragItems
    setActiveId(null)
    setDragItems(null)
    if (!over || !current) return
    const to = containerOf(String(over.id), current)
    if (!to) return

    let list = current[to]!
    const oldIndex = list.indexOf(id)
    const overIndex = list.indexOf(String(over.id))
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
      list = [...list]; list.splice(oldIndex, 1); list.splice(overIndex, 0, id)
    }
    const task = byId.get(id)!
    const visibleIndex = list.indexOf(id)
    if (to === dragOrigin.current && task.columnId === to && serverItems[to]!.indexOf(id) === visibleIndex) return

    // The board may be filtered: place the card after its visible neighbour in the full column.
    const full = tasks.filter(t => t.columnId === to && t.id !== id).sort((a, b) => a.position - b.position).map(t => t.id)
    const prev = list[visibleIndex - 1]
    const next = list[visibleIndex + 1]
    const index = prev ? full.indexOf(prev) + 1 : next ? Math.max(0, full.indexOf(next)) : full.length
    move.mutate({ taskId: id, columnId: to, index })

    const col = ws.columns.find(c => c.id === to)
    if (col && col.id !== task.columnId) toast(col.kind === 'Done' ? `أحسنت! اكتملت «${task.title}»` : `انتقلت إلى ${col.name}`)
  }

  const active = activeId ? byId.get(activeId) : null

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">المهام</h1>
          <p className="mt-1 text-sm text-muted">{canEdit ? 'اسحب البطاقة لمرحلة ثانية، أو افتحها لتعديل أي تفاصيل.' : 'تقدر تشوف اللوحة بس. اطلب من المشرف صلاحية التعديل.'}</p>
        </div>
        {canEdit && <QuickAdd workspace={ws} />}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line-strong bg-surface p-1">
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={clsx('relative rounded-md px-3 py-1.5 text-xs font-medium', filter === f.id ? 'text-white' : 'text-muted hover:text-ink')}>
              {filter === f.id && <motion.span layoutId="filter-pill" className="absolute inset-0 rounded-lg bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="relative">{f.label}</span>
            </button>
          ))}
        </div>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="تصفية حسب المشروع"
          className="h-9 rounded-md border border-line-strong bg-surface px-3 text-xs font-medium outline-none focus:border-accent">
          <option value="">كل المشاريع</option>
          {ws.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث في البطاقات" aria-label="ابحث في البطاقات"
            className="h-9 w-52 rounded-md border border-line-strong bg-surface ps-9 pe-3 text-xs outline-none focus:border-accent" />
        </label>
        <span className="ms-auto text-xs text-muted">يظهر {visible.length} من {tasks.length} بطاقة</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        onDragCancel={() => { setActiveId(null); setDragItems(null) }}>
        <div className="scroll-thin -mx-4 flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {ws.columns.map((col, i) => (
            <BoardColumn key={col.id} column={col} index={i} ids={items[col.id] ?? []} byId={byId} ws={ws} canEdit={canEdit} onOpen={setOpenTask} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {active && <CardView task={active} ws={ws} overlay />}
        </DragOverlay>
      </DndContext>

      <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />
      {toastNode}
    </div>
  )
}

/** Applies a move to the cached list the same way the server will, so the UI never jumps. */
function reorder(tasks: Task[], taskId: string, columnId: string, index: number, ws: Workspace): Task[] {
  const moving = tasks.find(t => t.id === taskId)
  if (!moving) return tasks
  const kind = ws.columns.find(c => c.id === columnId)?.kind
  const target = tasks.filter(t => t.columnId === columnId && t.id !== taskId).sort((a, b) => a.position - b.position)
  const updated: Task = {
    ...moving, columnId,
    completedAt: kind === 'Done' ? (moving.completedAt ?? new Date().toISOString()) : null,
  }
  target.splice(Math.min(index, target.length), 0, updated)
  const positions = new Map(target.map((t, i) => [t.id, i]))
  const source = moving.columnId !== columnId
    ? tasks.filter(t => t.columnId === moving.columnId && t.id !== taskId).sort((a, b) => a.position - b.position)
    : []
  source.forEach((t, i) => positions.set(t.id, i))
  return tasks.map(t => t.id === taskId ? { ...updated, position: positions.get(t.id)! } : positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t)
}

function BoardColumn({ column, index, ids, byId, ws, canEdit, onOpen }: {
  column: Column; index: number; ids: string[]; byId: Map<string, Task>; ws: Workspace; canEdit: boolean; onOpen: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canEdit })
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 30 }}
      className={clsx('flex w-[300px] shrink-0 flex-col rounded-2xl border bg-surface-2/70 p-3', isOver ? 'border-accent' : 'border-line')}
      aria-label={column.name}
    >
      <header className="mb-3 flex items-center gap-2 px-1">
        <span className="size-2 rounded-full" style={{ background: kindColor[column.kind] }} />
        <h2 className="text-sm font-bold">{column.name}</h2>
        <span className="rounded-md bg-surface px-1.5 text-xs font-semibold text-muted">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="scroll-thin flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto">
          {ids.map(id => byId.get(id) && <SortableCard key={id} task={byId.get(id)!} ws={ws} disabled={!canEdit} onOpen={onOpen} />)}
          {ids.length === 0 && (
            <div className="grid flex-1 place-items-center rounded-xl border-2 border-dashed border-line py-8 text-xs text-muted">
              {canEdit ? 'أفلت البطاقة هنا' : 'لا توجد بطاقات'}
            </div>
          )}
        </div>
      </SortableContext>
    </motion.section>
  )
}

const SortableCard = memo(function SortableCard({ task, ws, disabled, onOpen }: { task: Task; ws: Workspace; disabled: boolean; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes} {...listeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(task.id); listeners?.onKeyDown?.(e) }}
      className={clsx('outline-none', isDragging && 'opacity-30')}
    >
      <CardView task={task} ws={ws} />
    </div>
  )
})

function CardView({ task, ws, overlay }: { task: Task; ws: Workspace; overlay?: boolean }) {
  const project = ws.projects.find(p => p.id === task.projectId)
  const people = task.assigneeIds.map(id => ws.members.find(m => m.userId === id)).filter(Boolean) as Member[]
  const done = !!task.completedAt
  const overdue = !done && task.dueDate && new Date(task.dueDate) < startOfToday()
  const pct = task.checklistTotal ? Math.round((task.checklistDone / task.checklistTotal) * 100) : 0

  return (
    <motion.article
      layout={!overlay}
      initial={overlay ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1, rotate: overlay ? 2.5 : 0 }}
      className={clsx(
        'group cursor-grab rounded-2xl border border-line bg-surface p-3.5 shadow-card hover:border-accent/40 active:cursor-grabbing',
        overlay && 'cursor-grabbing shadow-2xl ring-2 ring-accent',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {task.tag && <Badge color={project?.color ?? 'var(--accent)'}>{task.tag}</Badge>}
        <Badge color={priorityColor[task.priority]}><Flag size={11} /> {priorityLabel[task.priority]}</Badge>
      </div>
      <h3 className={clsx('text-[13px] font-bold leading-snug', done && 'text-muted line-through decoration-1')}>{task.title}</h3>
      {project && <p className="mt-1 truncate text-[11px] text-muted">{project.name}</p>}
      {task.checklistTotal > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-label={`أُنجز ${pct}% من قائمة التحقق`}>
          <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
        </div>
      )}
      <footer className="mt-3 flex items-center gap-3 text-[11px] text-muted">
        {task.dueDate && (
          <span className={clsx('inline-flex items-center gap-1', overdue && 'font-semibold text-danger')}>
            <CalendarDays size={13} /> {done ? shortDate(task.dueDate) : formatDue(task.dueDate)}
          </span>
        )}
        {task.checklistTotal > 0 && <span className="inline-flex items-center gap-1"><CheckSquare size={12} /> {task.checklistDone}/{task.checklistTotal}</span>}
        {task.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> {task.commentCount}</span>}
        <span className="ms-auto flex -space-x-1.5">
          {people.slice(0, 3).map(p => <Avatar key={p.userId} name={p.displayName} color={p.avatarColor} size={22} />)}
        </span>
      </footer>
    </motion.article>
  )
}

function QuickAdd({ workspace }: { workspace: Workspace }) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const create = useMutation({
    mutationFn: () => api.post<Task>(`/api/workspaces/${workspaceId}/tasks`, {
      title, projectId: projectId || null, assigneeIds: me ? [me.id] : [],
    }),
    onSuccess: t => {
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old ? [...old, t] : [t])
      qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
      setTitle('')
    },
  })
  return (
    <div className="flex items-center gap-2">
      <AnimatePresence>
        {open && (
          <motion.form
            initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-2 overflow-hidden"
            onSubmit={e => { e.preventDefault(); if (title.trim()) create.mutate() }}
          >
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={`بطاقة جديدة في ${workspace.columns[0]?.name ?? ''}`} maxLength={200}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
              className="h-10 w-56 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent" aria-label="عنوان البطاقة" />
            <ProjectSelect projects={workspace.projects} value={projectId} onChange={setProjectId} />
            <Button loading={create.isPending} disabled={!title.trim()}>إضافة</Button>
          </motion.form>
        )}
      </AnimatePresence>
      <Button variant={open ? 'ghost' : 'primary'} onClick={() => setOpen(o => !o)}>{open ? 'تم' : <><Plus size={16} /> مهمة جديدة</>}</Button>
    </div>
  )
}

function ProjectSelect({ projects, value, onChange }: { projects: Project[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label="المشروع"
      className="h-10 rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent">
      <option value="">بدون مشروع</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

export function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
export function formatDue(date: string) {
  const d = new Date(date + 'T00:00:00')
  const diff = Math.round((d.getTime() - startOfToday().getTime()) / 86_400_000)
  if (diff === 0) return 'اليوم'
  if (diff === 1) return 'غدًا'
  if (diff === -1) return 'أمس'
  if (diff < 0) return `متأخرة ${count(-diff, 'يوم', 'يومين', 'أيام')}`
  if (diff < 7) return `بعد ${count(diff, 'يوم', 'يومين', 'أيام')}`
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
}
