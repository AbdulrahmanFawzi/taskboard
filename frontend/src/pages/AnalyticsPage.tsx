import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Download, TrendingDown, TrendingUp } from '../components/icons'
import clsx from 'clsx'
import { api, tz } from '../lib/api'
import { keys, useOwnCardsOnly, useWorkspaceId } from '../lib/workspace'
import type { Analytics, Metric } from '../lib/types'
import { Avatar, Card, CountUp, PageLoader, priorityColor } from '../components/ui'
import { kindColor } from './BoardPage'
import { tooltipStyle } from './DashboardPage'
import { priorityLabel, shortDate } from '../lib/i18n'

const ranges = [7, 30, 90] as const

export function AnalyticsPage() {
  const workspaceId = useWorkspaceId()
  const [range, setRange] = useState<number>(30)
  const ownOnly = useOwnCardsOnly()
  const { data, isFetching } = useQuery({
    queryKey: keys.analytics(workspaceId, range),
    queryFn: () => api.get<Analytics>(`/api/workspaces/${workspaceId}/analytics?range=${range}&tz=${tz()}`),
    placeholderData: prev => prev,
  })
  if (!data) return <PageLoader />

  const totalHours = data.timeByProject.reduce((s, p) => s + p.hours, 0)
  const short = shortDate

  return (
    <div className={clsx('mx-auto max-w-7xl space-y-6 p-4 transition-opacity sm:p-6', isFetching && 'opacity-80')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">التحليلات</h1>
          <p className="mt-1 text-sm text-muted">{ownOnly ? 'تقدّمك في بطاقاتك، ووين يروح وقتك.' : 'كيف يتقدّم الفريق، ووين يروح الوقت.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line-strong bg-surface p-1" role="tablist" aria-label="الفترة">
            {ranges.map(r => (
              <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
                className={clsx('relative rounded-md px-3 py-1.5 text-xs font-medium', range === r ? 'text-white' : 'text-muted hover:text-ink')}>
                {range === r && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-lg bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative">{r} يوم</span>
              </button>
            ))}
          </div>
          <a href={`/api/workspaces/${workspaceId}/analytics/export?range=${range}`} download
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
            <Download size={16} /> تصدير CSV
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile label="المهام المنجزة" metric={data.tasksCompleted} i={0} />
        <MetricTile label="الساعات المسجّلة" metric={data.hoursTracked} decimals={1} i={1} />
        <MetricTile label="التسليم في الموعد" metric={data.onTimeRate} suffix="%" decimals={0} i={2} />
        <MetricTile label="متوسط مدة الإنجاز" metric={data.avgCycleDays} suffix=" يوم" decimals={1} lowerIsBetter i={3} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="معدل الإنجاز" subtitle="البطاقات المنجزة كل يوم، مقارنة بالفترة السابقة"
          action={<div className="flex gap-3 text-xs text-muted"><Legend color="var(--accent)" label="الفترة الحالية" /><Legend color="var(--muted)" dashed label="السابقة" /></div>}>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data.throughput.map(p => ({ ...p, label: short(p.date) }))} margin={{ left: 8, right: -24, top: 8 }}>
                <defs>
                  <linearGradient id="tp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" reversed axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} minTickGap={24} />
                <YAxis orientation="right" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="previous" name="السابقة" stroke="var(--muted)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} animationDuration={900} />
                <Area type="monotone" dataKey="current" name="الحالية" stroke="var(--accent)" fill="url(#tp)" strokeWidth={2.5} animationDuration={1100} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="الوقت حسب المشروع" subtitle="ساعات البطاقات المنجزة في هذه الفترة">
          {data.timeByProject.length === 0 ? <p className="py-10 text-center text-sm text-muted">ما فيه وقت مسجّل في هذه الفترة.</p> : (
            <>
              <div className="relative h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.timeByProject} dataKey="hours" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={3} cornerRadius={6} stroke="none" animationDuration={1000}>
                      {data.timeByProject.map(p => <Cell key={p.name} fill={p.color} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} ساعة`]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div><p className="text-2xl font-bold"><CountUp value={totalHours} /></p><p className="text-[11px] text-muted">ساعة مسجّلة</p></div>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {data.timeByProject.map(p => (
                  <li key={p.name} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="font-semibold tabular-nums">{p.hours} س</span>
                    <span className="w-10 text-end text-xs text-muted">{totalHours ? Math.round((p.hours / totalHours) * 100) : 0}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="النشاط" subtitle="كل اللي سواه الفريق في آخر 12 أسبوع">
          <Heatmap days={data.heatmap} />
        </Card>
        <Card title="الأكثر إنجازًا" subtitle="البطاقات المنجزة في هذه الفترة">
          {data.topContributors.length === 0 ? <p className="py-6 text-center text-sm text-muted">ما فيه بطاقات منجزة بعد.</p> : (
            <ul className="space-y-3">
              {data.topContributors.map((c, i) => (
                <motion.li key={c.userId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center gap-3">
                  <Avatar name={c.displayName} color={c.avatarColor} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.displayName}</p>
                    <p className="text-xs text-muted">{c.hours} ساعة مسجّلة</p>
                  </div>
                  <span className="text-sm font-extrabold tabular-nums">{c.completed}</span>
                </motion.li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="حسب الحالة" subtitle="عدد البطاقات في كل عمود الآن">
          <Bars rows={data.byStatus.map(s => ({ label: s.name, value: s.count, color: kindColor[s.kind]! }))} />
        </Card>
        <Card title="المهام المفتوحة حسب الأولوية">
          <Bars rows={data.byPriority.map(p => ({ label: priorityLabel[p.priority], value: p.count, color: priorityColor[p.priority]! }))} />
        </Card>
      </div>
    </div>
  )
}

function MetricTile({ label, metric, suffix = '', decimals = 0, lowerIsBetter, i }: {
  label: string; metric: Metric; suffix?: string; decimals?: number; lowerIsBetter?: boolean; i: number
}) {
  const change = metric.previous ? ((metric.value - metric.previous) / metric.previous) * 100 : null
  const good = change === null ? null : lowerIsBetter ? change <= 0 : change >= 0
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, type: 'spring', stiffness: 300, damping: 28 }}
      className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold"><CountUp value={metric.value} decimals={decimals} suffix={suffix} /></p>
      <p className={clsx('mt-1 inline-flex items-center gap-1 text-xs font-semibold', good === null ? 'text-muted' : good ? 'text-ok' : 'text-danger')}>
        {change === null ? 'لا توجد بيانات سابقة' : <>{change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}<span dir="ltr">{change >= 0 ? '+' : ''}{change.toFixed(1)}%</span> عن الفترة السابقة</>}
      </p>
      <div className="mt-3 h-10">
        <ResponsiveContainer>
          <LineChart data={metric.spark.map((v, idx) => ({ v, idx }))}>
            <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} animationDuration={1200} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

function Heatmap({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map(d => d.count))
  // Columns are weeks; pad the front so each column starts on Monday.
  const firstDow = (new Date(days[0]!.date + 'T00:00:00').getDay() + 6) % 7
  const cells: ({ date: string; count: number } | null)[] = [...Array(firstDow).fill(null), ...days]
  const weeks: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return (
    <div>
      <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-1.5">
            {w.map((d, di) => d ? (
              <motion.div key={d.date} title={`${shortDate(d.date)}: ${d.count} تحديث`}
                initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: wi * 0.025 + di * 0.01 }}
                className="size-4 rounded-[4px] sm:size-5"
                style={{ background: d.count === 0 ? 'var(--surface-2)' : `color-mix(in oklab, var(--accent) ${20 + (d.count / max) * 80}%, transparent)` }} />
            ) : <div key={di} className="size-4 sm:size-5" />)}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        أقل {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <span key={f} className="size-3 rounded-[3px]" style={{ background: f === 0 ? 'var(--surface-2)' : `color-mix(in oklab, var(--accent) ${20 + f * 80}%, transparent)` }} />
        ))} أكثر
      </div>
    </div>
  )
}

function Bars({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[104px_1fr_32px] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <motion.div className="h-full rounded-full" style={{ background: r.color }}
              initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ delay: i * 0.06, duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <span className="text-end font-semibold tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-4" style={{ background: dashed ? `repeating-linear-gradient(270deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
      {label}
    </span>
  )
}
