import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, FolderKanban, ListTodo, Plus } from '../components/icons'
import clsx from 'clsx'
import { api, tz } from '../lib/api'
import { useAuth } from '../lib/auth'
import { keys, useCan, useOwnCardsOnly, useWorkspace, useWorkspaceId } from '../lib/workspace'
import type { Dashboard } from '../lib/types'
import { Avatar, Badge, Card, CountUp, PageLoader, priorityColor } from '../components/ui'
import { TaskModal } from '../components/TaskModal'
import { formatDue, startOfToday } from './BoardPage'
import { count, longDate, LOCALE, priorityLabel, weekday } from '../lib/i18n'

export function DashboardPage() {
  const workspaceId = useWorkspaceId()
  const { data: ws } = useWorkspace()
  const { me } = useAuth()
  const canEdit = useCan('Member')
  const ownOnly = useOwnCardsOnly()
  const [openTask, setOpenTask] = useState<string | null>(null)
  const { data } = useQuery({
    queryKey: keys.dashboard(workspaceId),
    queryFn: () => api.get<Dashboard>(`/api/workspaces/${workspaceId}/dashboard?tz=${tz()}`),
  })
  if (!data || !ws || !me) return <PageLoader />

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير'
  const delta = data.lastWeekTotal ? Math.round(((data.completedThisWeek - data.lastWeekTotal) / data.lastWeekTotal) * 100) : null
  const todayIso = new Date(startOfToday().getTime() - startOfToday().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

  const stats = [
    { label: 'إجمالي المشاريع', value: data.totalProjects, icon: FolderKanban, note: `في الفريق ${count(ws.members.length, 'شخص واحد', 'شخصان', 'أشخاص', 'شخصًا')}` },
    { label: 'المهام النشطة', value: data.activeTasks, icon: ListTodo, note: `${data.dueToday} تستحق اليوم` },
    { label: 'أُنجز هذا الأسبوع', value: data.completedThisWeek, icon: CheckCircle2, note: delta === null ? 'أول أسبوع من البيانات' : `${delta >= 0 ? '+' : ''}${delta}% مقارنة بالأسبوع الماضي` },
    { label: 'متأخرة', value: data.overdue, icon: AlertTriangle, note: data.overdue ? 'تحتاج متابعة' : 'كل شي في وقته', alert: data.overdue > 0 },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{greeting}، {me.displayName.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date().toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })} · {data.activeTasks} مهمة مفتوحة، و{data.dueToday} تستحق اليوم{ownOnly && ' · الأرقام هنا لبطاقاتك أنت فقط'}
          </p>
        </div>
        {canEdit && (
          <Link to="board" className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-sm hover:bg-accent-strong">
            <Plus size={16} /> إضافة مهمة
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, type: 'spring', stiffness: 300, damping: 28 }}
            className={clsx('rounded-2xl border p-5 shadow-card', i === 0 ? 'border-transparent bg-accent text-white' : 'border-line bg-surface')}>
            <div className="flex items-center justify-between">
              <p className={clsx('text-xs font-semibold', i === 0 ? 'text-white/80' : 'text-muted')}>{s.label}</p>
              <s.icon size={18} className={i === 0 ? 'text-white/80' : s.alert ? 'text-danger' : 'text-muted'} />
            </div>
            <p className="mt-3 text-3xl font-bold"><CountUp value={s.value} /></p>
            <p className={clsx('mt-1 text-xs', i === 0 ? 'text-white/80' : s.alert ? 'font-semibold text-danger' : 'text-muted')}>{s.note}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="هذا الأسبوع" subtitle="البطاقات اللي أنجزها الفريق في أيام العمل (الأحد إلى الخميس)">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold"><CountUp value={data.completedThisWeek} /></span>
            <span className="text-sm text-muted">أُنجزت حتى الآن</span>
            {delta !== null && <span className={clsx('text-xs font-bold', delta >= 0 ? 'text-ok' : 'text-danger')}>{delta >= 0 ? '+' : ''}{delta}% مقارنة بالأسبوع الماضي</span>}
            {data.weekendThisWeek > 0 && <span className="text-xs text-muted">(منها {data.weekendThisWeek} في الإجازة)</span>}
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={data.thisWeek.map(d => ({ ...d, day: weekday(d.date) }))}>
                <XAxis dataKey="day" reversed axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={v => [v, 'أُنجزت']} />
                <Bar dataKey="count" radius={[8, 8, 8, 8]} animationDuration={900}>
                  {data.thisWeek.map(d => (
                    <Cell key={d.date} fill="var(--accent)" fillOpacity={d.date === todayIso ? 1 : d.date > todayIso ? 0.15 : 0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="المشاريع" subtitle="نسبة البطاقات المكتملة">
          <ul className="space-y-4">
            {data.projects.length === 0 && <li className="text-sm text-muted">لا توجد مشاريع بعد. أضف مشروعًا من الإعدادات.</li>}
            {data.projects.map((p, i) => {
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
              return (
                <li key={p.id}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
                    <span className="text-xs text-muted">{p.done}/{p.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <motion.div className="h-full rounded-full" style={{ background: p.color }}
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="مهامي" subtitle="المسندة لك، الأقرب موعدًا أولًا" action={<Link to="board" className="text-xs font-semibold text-accent hover:underline">فتح اللوحة</Link>}>
          {data.myTasks.length === 0 ? <p className="py-6 text-center text-sm text-muted">ما فيه مهام مسندة لك حاليًا.</p> : (
            <ul className="divide-y divide-line">
              {data.myTasks.map((t, i) => {
                const project = ws.projects.find(p => p.id === t.projectId)
                const late = t.dueDate && new Date(t.dueDate) < startOfToday()
                return (
                  <motion.li key={t.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                    <button onClick={() => setOpenTask(t.id)} className="flex w-full items-center gap-3 rounded-lg px-1 py-3 text-start hover:bg-surface-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: project?.color ?? 'var(--muted)' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="text-xs text-muted">{project?.name ?? 'بدون مشروع'}</span>
                      </span>
                      <Badge color={priorityColor[t.priority]}>{priorityLabel[t.priority]}</Badge>
                      {t.dueDate && <span className={clsx('w-24 text-end text-xs', late ? 'font-semibold text-danger' : 'text-muted')}>{formatDue(t.dueDate)}</span>}
                    </button>
                  </motion.li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="آخر النشاطات">
          <ul className="space-y-3.5">
            {data.recentActivity.map(a => (
              <li key={a.id} className="flex gap-2.5 text-sm">
                <Avatar name={a.actorName} color={a.actorColor} size={26} />
                <p className="min-w-0 leading-snug">
                  <b>{a.actorName}</b> <span className="text-muted">{a.summary}</span>
                  <span className="block text-[11px] text-muted">{timeAgo(a.createdAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />
    </div>
  )
}

export const tooltipStyle = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--text)',
  boxShadow: '0 8px 24px rgb(0 0 0 / .12)',
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'الآن'
  if (s < 3600) return `قبل ${count(Math.floor(s / 60), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`
  if (s < 86400) return `قبل ${count(Math.floor(s / 3600), 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`
  if (s < 86400 * 7) return `قبل ${count(Math.floor(s / 86400), 'يوم', 'يومين', 'أيام', 'يومًا')}`
  return longDate(iso)
}
