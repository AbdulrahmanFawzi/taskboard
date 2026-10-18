import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Trash2, X } from './icons'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { keys, useCan, useWorkspace, useWorkspaceId } from '../lib/workspace'
import { priorities, type ChecklistItem, type Comment, type Task, type TaskDetail } from '../lib/types'
import { Avatar, Button, ErrorNote, Modal, PageLoader, priorityColor } from './ui'
import { dateTime, longDate, priorityLabel } from '../lib/i18n'

export function TaskModal({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  return (
    <Modal open={!!taskId} onClose={onClose} wide title="تفاصيل البطاقة">
      {taskId && <TaskEditor taskId={taskId} onClose={onClose} />}
    </Modal>
  )
}

function TaskEditor({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const workspaceId = useWorkspaceId()
  const { data: ws } = useWorkspace()
  const { me } = useAuth()
  const canEdit = useCan('Member')
  const canModerate = useCan('Admin')
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: keys.task(taskId), queryFn: () => api.get<TaskDetail>(`/api/tasks/${taskId}`) })
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newItem, setNewItem] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (detail.data) { setTitle(detail.data.task.title); setDescription(detail.data.task.description) }
  }, [detail.data?.task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (t?: Task) => {
    if (t) {
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old?.map(x => x.id === t.id ? t : x))
      qc.setQueryData<TaskDetail>(keys.task(taskId), old => old && { ...old, task: t })
    }
    qc.invalidateQueries({ queryKey: keys.task(taskId) })
    qc.invalidateQueries({ queryKey: keys.tasks(workspaceId) })
    qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
  }

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Task>(`/api/tasks/${taskId}`, body),
    onSuccess: refresh,
  })
  const move = useMutation({
    mutationFn: (columnId: string) => api.post(`/api/tasks/${taskId}/move`, { columnId, index: 0 }),
    onSuccess: () => refresh(),
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/tasks/${taskId}`),
    onSuccess: () => {
      qc.setQueryData<Task[]>(keys.tasks(workspaceId), old => old?.filter(t => t.id !== taskId))
      qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
      onClose()
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

  if (detail.isLoading || !ws) return <PageLoader />
  if (detail.error || !detail.data) return <ErrorNote error={detail.error ?? 'هذه البطاقة لم تعد موجودة.'} />
  const { task, checklist, comments } = detail.data
  const error = update.error ?? move.error ?? remove.error ?? addItem.error ?? addComment.error

  const toggleAssignee = (userId: string) => {
    const next = task.assigneeIds.includes(userId) ? task.assigneeIds.filter(id => id !== userId) : [...task.assigneeIds, userId]
    update.mutate({ assigneeIds: next })
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_220px]">
      <div className="min-w-0 space-y-5">
        <input
          value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit} maxLength={200} aria-label="العنوان"
          onBlur={() => { if (title.trim() && title !== task.title) update.mutate({ title }) }}
          className="w-full rounded-lg bg-transparent px-1 py-0.5 text-xl font-bold outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <div>
          <h3 className="mb-1.5 text-sm font-semibold">الوصف</h3>
          <textarea
            value={description} onChange={e => setDescription(e.target.value)} disabled={!canEdit} rows={4} maxLength={10000}
            onBlur={() => { if (description !== task.description) update.mutate({ description }) }}
            placeholder={canEdit ? 'أضف تفاصيل أو روابط أو معايير القبول' : 'لا يوجد وصف'}
            className="w-full resize-y rounded-md border border-line-strong bg-surface p-3 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
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
        </div>

        <div>
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
        </div>
        <ErrorNote error={error} />
      </div>

      <aside className="space-y-4 text-sm">
        <Side label="الحالة">
          <select value={task.columnId} disabled={!canEdit} onChange={e => move.mutate(e.target.value)} className={selectCls} aria-label="الحالة">
            {ws.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Side>
        <Side label="الأولوية">
          <div className="grid grid-cols-2 gap-1">
            {priorities.map(p => (
              <button key={p} disabled={!canEdit} onClick={() => update.mutate({ priority: p })}
                className={clsx('rounded-lg border px-2 py-1.5 text-xs font-semibold', task.priority === p ? 'border-transparent text-white' : 'border-line text-muted hover:text-ink')}
                style={task.priority === p ? { background: priorityColor[p] } : undefined}>{priorityLabel[p]}</button>
            ))}
          </div>
        </Side>
        <Side label="المشروع">
          <select value={task.projectId ?? ''} disabled={!canEdit} aria-label="المشروع" className={selectCls}
            onChange={e => update.mutate(e.target.value ? { projectId: e.target.value } : { clearProject: true })}>
            <option value="">بدون مشروع</option>
            {ws.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Side>
        <Side label="تاريخ الاستحقاق">
          <input type="date" value={task.dueDate ?? ''} disabled={!canEdit} aria-label="تاريخ الاستحقاق" className={selectCls}
            onChange={e => update.mutate(e.target.value ? { dueDate: e.target.value } : { clearDueDate: true })} />
        </Side>
        <Side label="الوسم">
          <input defaultValue={task.tag ?? ''} key={task.tag} disabled={!canEdit} maxLength={30} placeholder="تطوير، تصميم…" aria-label="الوسم" className={selectCls}
            onBlur={e => { if (e.target.value !== (task.tag ?? '')) update.mutate({ tag: e.target.value }) }} />
        </Side>
        <Side label="الوقت المسجّل">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-muted" />
            <input type="number" min={0} step={0.5} defaultValue={task.trackedMinutes / 60} key={task.trackedMinutes} disabled={!canEdit} aria-label="الساعات المسجّلة"
              className={clsx(selectCls, 'w-20')}
              onBlur={e => { const m = Math.round(Number(e.target.value) * 60); if (m >= 0 && m !== task.trackedMinutes) update.mutate({ trackedMinutes: m }) }} />
            <span className="text-xs text-muted">ساعة</span>
          </div>
        </Side>
        <Side label="المسؤولون">
          <div className="space-y-1">
            {ws.members.map(m => {
              const on = task.assigneeIds.includes(m.userId)
              return (
                <button key={m.userId} disabled={!canEdit} onClick={() => toggleAssignee(m.userId)}
                  className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs', on ? 'bg-accent-soft font-bold' : 'hover:bg-surface-2')}>
                  <Avatar name={m.displayName} color={m.avatarColor} size={22} />
                  <span className="flex-1 truncate">{m.displayName}</span>
                  {on && <Check size={14} className="text-accent" />}
                </button>
              )
            })}
          </div>
        </Side>
        {canEdit && (
          <Button variant="outline" className="w-full !text-danger" loading={remove.isPending}
            onClick={() => { if (confirm('حذف هذه البطاقة؟ لا يمكن التراجع عن الحذف.')) remove.mutate() }}>
            <Trash2 size={15} /> حذف البطاقة
          </Button>
        )}
        <p className="text-[11px] text-muted">أُنشئت {longDate(task.createdAt)}{task.completedAt && ` · اكتملت ${longDate(task.completedAt)}`}</p>
      </aside>
    </div>
  )
}

const selectCls = 'h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent disabled:opacity-70'

function Side({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-1.5 text-sm font-semibold">{label}</p>{children}</div>
}
