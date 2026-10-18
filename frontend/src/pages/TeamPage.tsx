import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Link2, Trash2, UserPlus } from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { keys, useCan, useWorkspace, useWorkspaceId } from '../lib/workspace'
import { roleRank, type Invitation, type Role } from '../lib/types'
import { Avatar, Button, Card, ErrorNote, Field, PageLoader, useToast } from '../components/ui'
import { count, longDate, roleLabel } from '../lib/i18n'

const roleHelp: Record<Role, string> = {
  Owner: 'كل الصلاحيات، ومنها حذف مساحة العمل',
  Admin: 'إدارة الأشخاص والأعمدة والمشاريع',
  Member: 'إنشاء البطاقات وتعديلها ونقلها',
  Viewer: 'اطّلاع فقط'
}

export function TeamPage() {
  const workspaceId = useWorkspaceId()
  const { data: ws } = useWorkspace()
  const { me } = useAuth()
  const isAdmin = useCan('Admin')
  const qc = useQueryClient()
  const { toast, toastNode } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('Member')

  const invites = useQuery({
    queryKey: keys.invitations(workspaceId),
    queryFn: () => api.get<Invitation[]>(`/api/workspaces/${workspaceId}/invitations`),
    enabled: isAdmin,
  })
  const refreshWs = () => qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) })

  const invite = useMutation({
    mutationFn: () => api.post<Invitation>(`/api/workspaces/${workspaceId}/invitations`, { email, role }),
    onSuccess: inv => {
      setEmail('')
      qc.invalidateQueries({ queryKey: keys.invitations(workspaceId) })
      copyLink(inv.token)
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/workspaces/${workspaceId}/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invitations(workspaceId) }),
  })
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.patch(`/api/workspaces/${workspaceId}/members/${v.userId}`, { role: v.role }),
    onSuccess: () => { refreshWs(); toast('تم تحديث الصلاحية') },
    onError: e => toast(e.message),
  })
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/api/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => { refreshWs(); toast('تمت الإزالة من مساحة العمل') },
    onError: e => toast(e.message),
  })

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${location.origin}/invite/${token}`).then(() => toast('تم نسخ رابط الدعوة'), () => toast('انسخ الرابط من القائمة بالأسفل'))
  }

  if (!ws || !me) return <PageLoader />
  const myRank = roleRank[ws.myRole]
  const assignable: Role[] = ws.myRole === 'Owner' ? ['Owner', 'Admin', 'Member', 'Viewer'] : ['Member', 'Viewer']

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الفريق</h1>
        <p className="mt-1 text-sm text-muted">في {ws.name} {count(ws.members.length, 'شخص واحد', 'شخصان', 'أشخاص', 'شخصًا')}، والكل يدخل بالتحقق الثنائي.</p>
      </div>

      {isAdmin && (
        <Card title="دعوة شخص" subtitle="بيوصله رابط للانضمام، يشتغل 7 أيام ولهذا البريد فقط.">
          <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); invite.mutate() }}>
            <Field label="البريد الإلكتروني" type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required className="min-w-56 flex-1" placeholder="name@company.com" />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">الصلاحية</span>
              <select value={role} onChange={e => setRole(e.target.value as Role)} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent">
                {assignable.filter(r => r !== 'Owner').map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
              </select>
            </label>
            <Button loading={invite.isPending}><UserPlus size={16} /> إنشاء رابط دعوة</Button>
          </form>
          <div className="mt-3"><ErrorNote error={invite.error} /></div>

          <AnimatePresence>
            {!!invites.data?.length && (
              <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 divide-y divide-line rounded-xl border border-line">
                {invites.data.map(i => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <Link2 size={16} className="text-muted" />
                    <span className="min-w-0 flex-1 truncate font-semibold" dir="ltr">{i.email}</span>
                    <span className="text-xs text-muted">{roleLabel[i.role]} · تنتهي {longDate(i.expiresAt)}</span>
                    <Button size="sm" variant="outline" onClick={() => copyLink(i.token)}><Copy size={14} /> نسخ الرابط</Button>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label={`إلغاء دعوة ${i.email}`}><Trash2 size={14} /></Button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </Card>
      )}

      <Card title="الأعضاء">
        <ul className="divide-y divide-line">
          {ws.members.map((m, idx) => {
            const isMe = m.userId === me.id
            const canManage = isAdmin && !isMe && (ws.myRole === 'Owner' || roleRank[m.role] < myRank)
            return (
              <motion.li key={m.userId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                className="flex flex-wrap items-center gap-3 py-3.5">
                <Avatar name={m.displayName} color={m.avatarColor} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{m.displayName} {isMe && <span className="text-xs font-semibold text-muted">(أنت)</span>}</p>
                  <p className="truncate text-xs text-muted" dir="ltr">{m.email}</p>
                </div>
                {canManage ? (
                  <select value={m.role} aria-label={`صلاحية ${m.displayName}`}
                    onChange={e => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                    className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm outline-none focus:border-accent">
                    {(assignable.includes(m.role) ? assignable : [m.role, ...assignable]).map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                ) : (
                  <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold" title={roleHelp[m.role]}>{roleLabel[m.role]}</span>
                )}
                {(canManage || (isMe && m.role !== 'Owner')) && (
                  <Button size="sm" variant="ghost" className="hover:!text-danger"
                    onClick={() => { if (confirm(isMe ? 'تغادر مساحة العمل هذه؟' : `إزالة ${m.displayName}؟`)) removeMember.mutate(m.userId) }}>
                    {isMe ? 'مغادرة' : 'إزالة'}
                  </Button>
                )}
              </motion.li>
            )
          })}
        </ul>
      </Card>

      <Card title="صلاحيات كل دور">
        <dl className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(roleHelp) as Role[]).map(r => (
            <div key={r} className="rounded-xl bg-surface-2 p-3.5">
              <dt className="text-sm font-bold">{roleLabel[r]}</dt>
              <dd className="mt-0.5 text-xs text-muted">{roleHelp[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {toastNode}
    </div>
  )
}
