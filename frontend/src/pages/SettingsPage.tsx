import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, Check, ShieldCheck, Trash2 } from '../components/icons'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { applyAccent, keys, useCan, useWorkspace, useWorkspaceId } from '../lib/workspace'
import type { ColumnKind, Workspace } from '../lib/types'
import { Button, Card, ErrorNote, Field, PageLoader, useToast } from '../components/ui'
import { CodeInput } from './AuthPages'
import { kindLabel } from '../lib/i18n'

// Platforms Code 600 shades, SA-flag green first.
const accents = ['#1b8354', '#175cd3', '#6938ef', '#dd2590', '#e04f16', '#0e9384', '#b87b02', '#384250']
const kinds = (Object.keys(kindLabel) as ColumnKind[]).map(id => ({ id, label: kindLabel[id] }))

export function SettingsPage() {
  const { data: ws } = useWorkspace()
  const isAdmin = useCan('Admin')
  if (!ws) return <PageLoader />
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted">{isAdmin ? 'إعدادات مساحة العمل واللوحة والحساب.' : 'إعدادات حسابك. لتغيير مساحة العمل تواصل مع المشرف.'}</p>
      </div>
      {isAdmin && <WorkspaceSettings ws={ws} />}
      {isAdmin && <ColumnSettings ws={ws} />}
      {isAdmin && <ProjectSettings ws={ws} />}
      <SecuritySettings />
      {ws.myRole === 'Owner' && <DangerZone ws={ws} />}
    </div>
  )
}

function useSaveWorkspace() {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name?: string; accentColor?: string }) => api.patch<Workspace>(`/api/workspaces/${workspaceId}`, body),
    onSuccess: ws => {
      qc.setQueryData(keys.workspace(workspaceId), ws)
      qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

function WorkspaceSettings({ ws }: { ws: Workspace }) {
  const save = useSaveWorkspace()
  const [name, setName] = useState(ws.name)
  const [accent, setAccent] = useState(ws.accentColor)
  useEffect(() => setAccent(ws.accentColor), [ws.accentColor])

  const pick = (c: string) => {
    setAccent(c)
    applyAccent(c) // preview instantly; the save makes it stick for everyone
    save.mutate({ accentColor: c })
  }

  return (
    <Card title="مساحة العمل" subtitle="لون رئيسي واحد يغيّر ألوان المنصة كاملة لكل أعضاء مساحة العمل. الأخضر هو لون الهوية الوطنية في كود المنصات.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); save.mutate({ name }) }}>
        <Field label="الاسم" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required className="min-w-56 flex-1" />
        <Button variant="outline" loading={save.isPending && !!save.variables?.name} disabled={name === ws.name}>حفظ الاسم</Button>
      </form>
      <p className="mt-5 mb-2 text-sm font-medium">اللون الرئيسي</p>
      <div className="flex flex-wrap items-center gap-2.5">
        {accents.map(c => (
          <button key={c} onClick={() => pick(c)} aria-label={`استخدام اللون ${c}`} aria-pressed={accent === c}
            className="relative grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface hover:scale-110 transition-transform" style={{ background: c }}>
            {accent === c && <motion.span layoutId="accent-ring" className="absolute -inset-1 rounded-full border-2" style={{ borderColor: c }} />}
            {accent === c && <Check size={16} className="text-white" strokeWidth={3} />}
          </button>
        ))}
        <label className="ms-1 inline-flex items-center gap-2 text-xs text-muted">
          لون مخصص <input type="color" value={accent} onChange={e => setAccent(e.target.value)} onBlur={e => pick(e.target.value)} className="size-9 cursor-pointer rounded-lg border border-line bg-transparent" />
        </label>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Card>
  )
}

function ColumnSettings({ ws }: { ws: Workspace }) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  const { toast, toastNode } = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ColumnKind>('Todo')
  const refresh = () => qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
  const add = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${workspaceId}/columns`, { name, kind }),
    onSuccess: () => { setName(''); refresh() },
  })
  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/api/workspaces/${workspaceId}/columns/${v.id}`, v.body),
    onSuccess: refresh,
    onError: e => toast(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/workspaces/${workspaceId}/columns/${id}`),
    onSuccess: refresh,
    onError: e => toast(e.message),
  })

  return (
    <Card title="أعمدة اللوحة" subtitle="نوع المرحلة يحدد للتحليلات أي عمود يعني الإنجاز.">
      <ul className="space-y-2">
        {ws.columns.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
            <input defaultValue={c.name} key={c.name} maxLength={40} aria-label="اسم العمود"
              onBlur={e => { if (e.target.value.trim() && e.target.value !== c.name) update.mutate({ id: c.id, body: { name: e.target.value } }) }}
              className="h-9 min-w-40 flex-1 rounded-lg bg-transparent px-2 text-sm font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2" />
            <select value={c.kind} onChange={e => update.mutate({ id: c.id, body: { kind: e.target.value } })} aria-label="نوع المرحلة"
              className="h-9 rounded-md border border-line-strong bg-surface px-2 text-xs outline-none">
              {kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => update.mutate({ id: c.id, body: { position: i - 1 } })} aria-label="نقل للأمام"><ArrowUp size={14} /></Button>
            <Button size="sm" variant="ghost" disabled={i === ws.columns.length - 1} onClick={() => update.mutate({ id: c.id, body: { position: i + 1 } })} aria-label="نقل للخلف"><ArrowDown size={14} /></Button>
            <Button size="sm" variant="ghost" className="hover:!text-danger" onClick={() => remove.mutate(c.id)} aria-label={`حذف ${c.name}`}><Trash2 size={14} /></Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) add.mutate() }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="عمود جديد" maxLength={40} aria-label="اسم العمود الجديد"
          className="h-10 min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent" />
        <select value={kind} onChange={e => setKind(e.target.value as ColumnKind)} aria-label="نوع مرحلة العمود الجديد" className="h-10 rounded-md border border-line-strong bg-surface px-2 text-sm outline-none">
          {kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <Button loading={add.isPending} disabled={!name.trim()}>إضافة عمود</Button>
      </form>
      <div className="mt-3"><ErrorNote error={add.error} /></div>
      {toastNode}
    </Card>
  )
}

function ProjectSettings({ ws }: { ws: Workspace }) {
  const workspaceId = useWorkspaceId()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState(accents[1]!)
  const refresh = () => qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
  const add = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${workspaceId}/projects`, { name, color }),
    onSuccess: () => { setName(''); refresh() },
  })
  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/api/workspaces/${workspaceId}/projects/${v.id}`, v.body),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/workspaces/${workspaceId}/projects/${id}`),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: keys.tasks(workspaceId) }) },
  })
  return (
    <Card title="المشاريع" subtitle="جمّع البطاقات حسب المشروع. حذف المشروع ما يحذف بطاقاته.">
      <ul className="grid gap-2 sm:grid-cols-2">
        {ws.projects.map(p => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
            <input type="color" value={p.color} onChange={e => update.mutate({ id: p.id, body: { color: e.target.value } })} aria-label={`لون ${p.name}`}
              className="size-8 cursor-pointer rounded-lg border-0 bg-transparent" />
            <input defaultValue={p.name} key={p.name} maxLength={80} aria-label="اسم المشروع"
              onBlur={e => { if (e.target.value.trim() && e.target.value !== p.name) update.mutate({ id: p.id, body: { name: e.target.value } }) }}
              className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2" />
            <Button size="sm" variant="ghost" className="hover:!text-danger" aria-label={`حذف ${p.name}`}
              onClick={() => { if (confirm(`حذف ${p.name}؟ بطاقاته بتبقى في اللوحة.`)) remove.mutate(p.id) }}><Trash2 size={14} /></Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) add.mutate() }}>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="لون المشروع الجديد" className="size-10 cursor-pointer rounded-md border border-line-strong bg-transparent" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="مشروع جديد" maxLength={80} aria-label="اسم المشروع الجديد"
          className="h-10 min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent" />
        <Button loading={add.isPending} disabled={!name.trim()}>إضافة مشروع</Button>
      </form>
    </Card>
  )
}

function SecuritySettings() {
  const { me, setMe } = useAuth()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const regenerate = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/2fa/recovery-codes', { code }),
    onSuccess: r => { setCodes(r.recoveryCodes); setCode(''); if (me) setMe({ ...me, recoveryCodesLeft: r.recoveryCodes.length }) },
  })
  if (!me) return null
  return (
    <Card title="أمان الدخول" subtitle={me.email}>
      <div className="flex items-center gap-3 rounded-xl bg-accent-soft p-4">
        <ShieldCheck className="text-accent" />
        <div className="text-sm">
          <p className="font-bold">التحقق الثنائي مفعّل</p>
          <p className="text-muted">{me.twoFactorRequired ? 'مطلوب لكل الحسابات في هذه المنصة.' : 'حسابك يطلب رمزًا عند الدخول.'} باقي لك {me.recoveryCodesLeft} من رموز الاسترداد.</p>
        </div>
      </div>
      <form className="mt-5 max-w-sm space-y-3" onSubmit={e => { e.preventDefault(); regenerate.mutate() }}>
        <p className="text-sm font-semibold">إنشاء رموز استرداد جديدة</p>
        <p className="text-xs text-muted">الرموز القديمة بتتوقف. أدخل رمزًا من تطبيق المصادقة للتأكيد.</p>
        <CodeInput value={code} onChange={setCode} />
        <ErrorNote error={regenerate.error} />
        <Button variant="outline" loading={regenerate.isPending} disabled={code.length !== 6}>إنشاء رموز جديدة</Button>
      </form>
      {codes && (
        <div dir="ltr" className="mt-4 grid max-w-sm grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 font-mono text-sm">
          {codes.map(c => <span key={c}>{c}</span>)}
          <Button size="sm" variant="outline" className="col-span-2 mt-2" onClick={() => navigator.clipboard.writeText(codes.join('\n'))}>نسخ الكل</Button>
        </div>
      )}
    </Card>
  )
}

function DangerZone({ ws }: { ws: Workspace }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirmName, setConfirmName] = useState('')
  const remove = useMutation({
    mutationFn: () => api.del(`/api/workspaces/${ws.id}`),
    onSuccess: () => { qc.removeQueries({ queryKey: keys.workspace(ws.id) }); qc.invalidateQueries({ queryKey: keys.workspaces }); navigate('/') },
  })
  return (
    <Card title="حذف مساحة العمل" subtitle="يحذف اللوحة وكل البطاقات وسجلها لجميع الأعضاء، ولا يمكن التراجع." className="border-danger/30">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`اكتب «${ws.name}» للتأكيد`} value={confirmName} onChange={e => setConfirmName(e.target.value)} className="min-w-56 flex-1" />
        <Button variant="danger" className={clsx()} disabled={confirmName !== ws.name} loading={remove.isPending} onClick={() => remove.mutate()}>حذف مساحة العمل</Button>
      </div>
      <div className="mt-3"><ErrorNote error={remove.error} /></div>
    </Card>
  )
}
