import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Trash2, X } from './icons'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { keys, useCan, useOwnCardsOnly, useWorkspace, useWorkspaceId } from '../lib/workspace'
import { priorities, type ChecklistItem, type Comment, type Priority, type Task, type TaskDetail } from '../lib/types'
import { Avatar, Button, ErrorNote, Modal, PageLoader, priorityColor, useToast } from './ui'
import { DatePicker } from './DatePicker'
import { dateTime, longDate, priorityLabel } from '../lib/i18n'

const discardMessage = 'عندك تعديلات ما حفظتها. تبغى تقفل بدون حفظ؟'

export function TaskModal({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const dirty = useRef(false)
  const { toast, toastNode } = useToast()
  // X, Escape and a click outside all come through here, so unsaved edits are never lost silently.
  const requestClose = useCallback(() => {
    if (dirty.current && !confirm(discardMessage)) return
    dirty.current = false
    onClose()
  }, [onClose])

  return (
    <>
      <Modal open={!!taskId} onClose={requestClose} wide title="تفاصيل البطاقة">
        {taskId && (
          <TaskEditor
            taskId={taskId}
            onDirtyChange={d => { dirty.current = d }}
            onCancel={requestClose}
            onDone={message => { dirty.current = false; onClose(); if (message) toast(message) }}
          />
        )}
      </Modal>
      {toastNode}
    </>
  )
}

/** The editable fields of a card. Checklist and comments save on their own buttons. */
interface Draft {
  title: string
  description: string
  columnId: string
  priority: Priority
  projectId: string
  dueDate: string | null
  tag: string
  hours: string
  assigneeIds: string[]
}

const draftOf = (t: Task): Draft => ({
  title: t.title,
  description: t.description,
  columnId: t.columnId,
  priority: t.priority,
  projectId: t.projectId ?? '',
  dueDate: t.dueDate,
  tag: t.tag ?? '',
  hours: String(t.trackedMinutes / 60),
  assigneeIds: t.assigneeIds,
})

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

function TaskEditor({ taskId, onDirtyChange, onCancel, onDone }: {
  taskId: string
  onDirtyChange: (dirty: boolean) => void
  onCancel: () => void
  onDone: (message?: string) => void
}) {
  const workspaceId = useWorkspaceId()
  const { data: ws } = useWorkspace()
  const { me } = useAuth()
  const canEdit = useCan('Member')
  const canModerate = useCan('Admin')
  const ownOnly = useOwnCardsOnly()
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: keys.task(taskId), queryFn: () => api.get<TaskDetail>(`/api/tasks/${taskId}`) })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newItem, setNewItem] = useState('')
  const [comment, setComment] = useState('')

  // Start the form from the card once; later refetches (someone else's edit) don't wipe your typing.
  useEffect(() => {
    if (detail.data && !draft) setDraft(draftOf(detail.data.task))
  }, [detail.data, draft])

  const task = detail.data?.task
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => d && { ...d, [key]: value })

  /** Only the fields that differ from the saved card go into the request. */
  const changes = useMemo(() => {
    if (!task || !draft) return null
    const body: Record<string, unknown> = {}
    if (draft.title.trim() !== task.title) body.title = draft.title.trim()
    if (draft.description.trim() !== task.description) body.description = draft.description.trim()
    if (draft.priority !== task.priority) body.priority = draft.priority
    if (draft.projectId !== (task.projectId ?? '')) Object.assign(body, draft.projectId ? { projectId: draft.projectId } : { clearProject: true })
    if (draft.dueDate !== task.dueDate) Object.assign(body, draft.dueDate ? { dueDate: draft.dueDate } : { clearDueDate: true })
    if (draft.tag.trim() !== (task.tag ?? '')) body.tag = draft.tag.trim()
    const minutes = Math.round(Number(draft.hours || 0) * 60)
    if (Number.isFinite(minutes) && minutes >= 0 && minutes !== task.trackedMinutes) body.trackedMinutes = minutes
    if (!sameIds(draft.assigneeIds, task.assigneeIds)) body.assigneeIds = draft.assigneeIds
    return { body, moved: draft.columnId !== task.columnId }
  }, [task, draft])

  const dirty = !!changes && (Object.keys(changes.body).length > 0 || changes.moved)
  const hoursValid = !draft || (draft.hours === '' || (Number(draft.hours) >= 0 && Number(draft.hours) <= 1666))
  const valid = !!draft?.title.trim() && hoursValid
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.task(taskId) })
    qc.invalidateQueries({ queryKey: keys.tasks(workspaceId) })
    qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!changes || !draft) return
      if (Object.keys(changes.body).length > 0) await api.patch<Task>(`/api/tasks/${taskId}`, changes.body)
      if (changes.moved) await api.post(`/api/tasks/${taskId}/move`, { columnId: draft.columnId, index: 0 })
    },
    onSuccess: () => { refresh(); onDone('تم حفظ التعديلات') },
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/tasks/${taskId}`),
    onSuccess: () => {
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old?.filter(t => t.id !== taskId))
      qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
      onDone('تم حذف البطاقة')
    },
  })
  const addItem = useMutation({
    mutationFn: () => api.post<ChecklistItem>(`/api/tasks/${taskId}/checklist`, { text: newItem }),
    onSuccess: () => { setNewItem(''); refresh() },
  })
  const toggleItem = useMutation({
    mutationFn: (i: ChecklistItem) => api.patch(`/api/tasks/${taskId}/checklist/${i.id}`, { done: !i.done }),
    onMutate: i => qc.setQueryData<TaskDetail>(keys.task(taskId), old => old && {
      ...old, checklist: old.checklist.map(c => c.id === i.id ? { ...c, done: !c.done } : c),
    }),
    onSettled: () => refresh(),
  })
  const deleteItem = useMutation({
    mutationFn: (id: string) => api.del(`/api/tasks/${taskId}/checklist/${id}`),
    onSuccess: () => refresh(),
  })
  const addComment = useMutation({
    mutationFn: () => api.post<Comment>(`/api/tasks/${taskId}/comments`, { body: comment }),
    onSuccess: () => { setComment(''); refresh() },
  })
  const deleteComment = useMutation({
    mutationFn: (id: string) => api.del(`/api/tasks/${taskId}/comments/${id}`),
    onSuccess: () => refresh(),
  })

  // Ctrl/⌘+Enter saves from anywhere in the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && dirty && valid && !save.isPending) { e.preventDefault(); save.mutate() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, valid, save])

  if (detail.isLoading || !ws || (detail.data && !draft)) return <PageLoader />
  if (detail.error || !detail.data || !draft || !task) return <ErrorNote error={detail.error ?? 'هذه البطاقة لم تعد موجودة.'} />
  const { checklist, comments } = detail.data
  const listError = remove.error ?? addItem.error ?? addComment.error

  const toggleAssignee = (userId: string) =>
    set('assigneeIds', draft.assigneeIds.includes(userId) ? draft.assigneeIds.filter(id => id !== userId) : [...draft.assigneeIds, userId])

  return (
    <div className="flex max-h-[calc(84vh-5rem)] flex-col">
      <div className="scroll-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div className="grid gap-6 md:grid-cols-[1fr_230px]">
          <div className="min-w-0 space-y-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">العنوان</span>
              <input
                value={draft.title} onChange={e => set('title', e.target.value)} disabled={!canEdit} maxLength={200}
                className={clsx('h-10 w-full rounded-md border bg-surface px-3 text-base font-bold outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft',
                  draft.title.trim() ? 'border-line-strong' : 'border-danger')}
              />
              {!draft.title.trim() && <span className="mt-1 block text-xs text-danger">البطاقة تحتاج عنوانًا.</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">الوصف</span>
              <textarea
                value={draft.description} onChange={e => set('description', e.target.value)} disabled={!canEdit} rows={4} maxLength={10000}
                placeholder={canEdit ? 'أضف تفاصيل أو روابط أو معايير القبول' : 'لا يوجد وصف'}
                className="w-full resize-y rounded-md border border-line-strong bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft"
              />
            </label>

            <section>
              <h3 className="mb-2 text-sm font-semibold">قائمة التحقق {checklist.length > 0 && `· ${checklist.filter(c => c.done).length}/${checklist.length}`}</h3>
              <ul className="space-y-1">
                {checklist.map(item => (
                  <li key={item.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                    <button disabled={!canEdit} onClick={() => toggleItem.mutate(item)} aria-label={item.done ? 'إلغاء الإنجاز' : 'تحديد كمنجز'}
                      className={clsx('grid size-5 place-items-center rounded-md border', item.done ? 'border-accent bg-accent text-white' : 'border-line')}>
                      {item.done && <Check size={13} strokeWidth={3} />}
                    </button>
                    <span className={clsx('flex-1 text-sm', item.done && 'text-muted line-through')}>{item.text}</span>
                    {canEdit && (
                      <button onClick={() => deleteItem.mutate(item.id)} className="rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100" aria-label="حذف البند"><X size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); if (newItem.trim()) addItem.mutate() }}>
                  <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="أضف بندًا" maxLength={300}
                    className="h-9 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent" />
                  <Button size="sm" variant="outline" loading={addItem.isPending} disabled={!newItem.trim()}>إضافة</Button>
                </form>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">التعليقات</h3>
              <ul className="space-y-3">
                {comments.map(c => (
                  <li key={c.id} className="group flex gap-2.5">
                    <Avatar name={c.authorName} color={c.authorColor} size={28} />
                    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
                      <p className="text-xs"><b>{c.authorName}</b> <span className="text-muted">{dateTime(c.createdAt)}</span></p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    </div>
                    {(c.authorId === me?.id || canModerate) && (
                      <button onClick={() => deleteComment.mutate(c.id)} className="self-start rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100" aria-label="حذف التعليق"><Trash2 size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (comment.trim()) addComment.mutate() }}>
                  <input value={comment} onChange={e => setComment(e.target.value)} placeholder="اكتب تعليقًا" maxLength={4000}
                    className="h-10 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent" />
                  <Button loading={addComment.isPending} disabled={!comment.trim()}>إرسال</Button>
                </form>
              )}
            </section>
            <ErrorNote error={listError} />
          </div>

          <aside className="space-y-4 text-sm">
            <Side label="الحالة">
              <select value={draft.columnId} disabled={!canEdit} onChange={e => set('columnId', e.target.value)} className={selectCls} aria-label="الحالة">
                {ws.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Side>
            <Side label="الأولوية">
              <div className="grid grid-cols-2 gap-1">
                {priorities.map(p => (
                  <button key={p} type="button" disabled={!canEdit} onClick={() => set('priority', p)} aria-pressed={draft.priority === p}
                    className={clsx('rounded-md border px-2 py-1.5 text-xs font-semibold', draft.priority === p ? 'border-transparent text-white' : 'border-line text-muted hover:text-ink')}
                    style={draft.priority === p ? { background: priorityColor[p] } : undefined}>{priorityLabel[p]}</button>
                ))}
              </div>
            </Side>
            <Side label="المشروع">
              <select value={draft.projectId} disabled={!canEdit} aria-label="المشروع" className={selectCls} onChange={e => set('projectId', e.target.value)}>
                <option value="">بدون مشروع</option>
                {ws.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Side>
            <Side label="تاريخ الاستحقاق">
              <DatePicker label="تاريخ الاستحقاق" value={draft.dueDate} onChange={v => set('dueDate', v)} disabled={!canEdit} />
            </Side>
            <Side label="الوسم">
              <input value={draft.tag} onChange={e => set('tag', e.target.value)} disabled={!canEdit} maxLength={30}
                placeholder="تطوير، تصميم…" aria-label="الوسم" className={selectCls} />
            </Side>
            <Side label="الوقت المسجّل">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-muted" />
                <input type="number" min={0} step={0.5} value={draft.hours} onChange={e => set('hours', e.target.value)} disabled={!canEdit}
                  aria-label="الساعات المسجّلة" className={clsx(selectCls, 'w-20', !hoursValid && '!border-danger')} />
                <span className="text-xs text-muted">ساعة</span>
              </div>
            </Side>
            <Side label="المسؤولون">
              {ownOnly && <p className="mb-1.5 text-[11px] text-muted">تقدر تسند البطاقة لنفسك فقط.</p>}
              <div className="space-y-1">
                {/* Members can add or remove only themselves; others already on the card show but stay fixed. */}
                {ws.members.filter(m => !ownOnly || m.userId === me?.id || draft.assigneeIds.includes(m.userId)).map(m => {
                  const on = draft.assigneeIds.includes(m.userId)
                  const locked = ownOnly && m.userId !== me?.id
                  return (
                    <button key={m.userId} type="button" disabled={!canEdit || locked} onClick={() => toggleAssignee(m.userId)} aria-pressed={on}
                      className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs', on ? 'bg-accent-soft font-bold' : 'hover:bg-surface-2')}>
                      <Avatar name={m.displayName} color={m.avatarColor} size={22} />
                      <span className="flex-1 truncate">{m.displayName}</span>
                      {on && <Check size={14} className="text-accent" />}
                    </button>
                  )
                })}
              </div>
            </Side>
            <p className="text-[11px] text-muted">أُنشئت {longDate(task.createdAt)}{task.completedAt && ` · اكتملت ${longDate(task.completedAt)}`}</p>
          </aside>
        </div>
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {canEdit ? (
          <>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !valid}>حفظ</Button>
            <Button variant="outline" onClick={onCancel} disabled={save.isPending}>إلغاء</Button>
            <span className="text-xs text-muted">{dirty ? 'فيه تعديلات ما انحفظت' : 'لا توجد تعديلات'}</span>
            <div className={clsx('ms-auto', ownOnly && task.createdById !== me?.id && 'hidden')}>
              <Button variant="ghost" className="hover:!text-danger" loading={remove.isPending}
                onClick={() => { if (confirm('حذف هذه البطاقة؟ لا يمكن التراجع عن الحذف.')) remove.mutate() }}>
                <Trash2 size={15} /> حذف البطاقة
              </Button>
            </div>
          </>
        ) : (
          <Button variant="outline" onClick={onCancel}>إغلاق</Button>
        )}
        {save.error && <div className="basis-full"><ErrorNote error={save.error} /></div>}
      </footer>
    </div>
  )
}

const selectCls = 'h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent disabled:opacity-70'

function Side({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-1.5 text-sm font-semibold">{label}</p>{children}</div>
}
