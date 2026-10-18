import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  BarChart3, ChevronDown, KanbanSquare, LayoutDashboard, LogOut, Menu, Moon, Plus, Settings, Sun, Users, X,
} from './components/icons'
import clsx from 'clsx'
import { api } from './lib/api'
import { useAuth } from './lib/auth'
import { applyAccent, getTheme, keys, setTheme, useRealtime, useWorkspace, type Theme } from './lib/workspace'
import type { InvitationPreview, Workspace, WorkspaceSummary } from './lib/types'
import { Avatar, Button, ErrorNote, Field, PageLoader } from './components/ui'
import { roleLabel } from './lib/i18n'
import { LoginPage, Logo, RegisterPage, TwoFactorSetupPage } from './pages/AuthPages'
import { DashboardPage } from './pages/DashboardPage'
import { BoardPage } from './pages/BoardPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { TeamPage } from './pages/TeamPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/setup-2fa" element={<NeedsEnrolment><TwoFactorSetupPage /></NeedsEnrolment>} />
      <Route path="/invite/:token" element={<RequireAuth><InvitePage /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
      <Route path="/new" element={<RequireAuth><NewWorkspacePage /></RequireAuth>} />
      <Route path="/w/:workspaceId" element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  const next = encodeURIComponent(location.pathname + location.search)
  if (!me) return <Navigate to={`/login?next=${next}`} replace />
  if (!me.sessionVerified) return <Navigate to={`/setup-2fa?next=${next}`} replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <PageLoader />
  if (me?.sessionVerified) return <Navigate to="/" replace />
  if (me && !me.twoFactorEnabled) return <Navigate to="/setup-2fa" replace />
  return <>{children}</>
}

function NeedsEnrolment({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!me) return <Navigate to="/login" replace />
  if (me.twoFactorEnabled) return <Navigate to="/" replace />
  return <>{children}</>
}

function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: () => api.get<WorkspaceSummary[]>('/api/workspaces') })
}

function HomeRedirect() {
  const { data, isLoading } = useWorkspaces()
  if (isLoading || !data) return <PageLoader />
  let last: string | null = null
  try { last = localStorage.getItem('tb.lastWorkspace') } catch { /* storage blocked */ }
  const target = data.find(w => w.id === last) ?? data[0]
  return target ? <Navigate to={`/w/${target.id}`} replace /> : <Navigate to="/new" replace />
}

function NewWorkspacePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: existing } = useWorkspaces()
  const [name, setName] = useState('')
  const [sample, setSample] = useState(true)
  const create = useMutation({
    mutationFn: () => api.post<Workspace>('/api/workspaces', { name, withSampleData: sample }),
    onSuccess: ws => {
      qc.invalidateQueries({ queryKey: keys.workspaces })
      qc.setQueryData(keys.workspace(ws.id), ws)
      navigate(`/w/${ws.id}`)
    },
  })
  return (
    <div className="grid min-h-full place-items-center p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-card">
        <Logo />
        <h1 className="mt-8 text-2xl font-bold">إنشاء مساحة عمل</h1>
        <p className="mt-1.5 text-sm text-muted">مساحة العمل فيها لوحة مهام وحدة، مع مشاريعها والأشخاص المشاركين فيها.</p>
        <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); create.mutate() }}>
          <Field label="اسم مساحة العمل" value={name} onChange={e => setName(e.target.value)} placeholder="فريق المنتج" required minLength={2} maxLength={80} autoFocus />
          <label className="flex items-start gap-3 rounded-xl border border-line p-3.5 text-sm">
            <input type="checkbox" checked={sample} onChange={e => setSample(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span><b>ابدأ ببيانات تجريبية</b><br /><span className="text-muted">مشاريع وبطاقات وسجل لآخر شهرين، عشان تلاقي لوحة المؤشرات والتحليلات فيها بيانات من أول يوم.</span></span>
          </label>
          <ErrorNote error={create.error} />
          <Button className="w-full" loading={create.isPending}>إنشاء مساحة العمل</Button>
          {!!existing?.length && <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(-1)}>إلغاء</Button>}
        </form>
      </motion.div>
    </div>
  )
}

function InvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { me } = useAuth()
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<InvitationPreview>(`/api/invitations/${token}`), retry: false })
  const accept = useMutation({
    mutationFn: () => api.post<WorkspaceSummary>(`/api/invitations/${token}/accept`),
    onSuccess: ws => { qc.invalidateQueries({ queryKey: keys.workspaces }); navigate(`/w/${ws.id}`) },
  })
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <Logo />
        {preview.isLoading ? <PageLoader /> : preview.error ? (
          <p className="mt-8 text-muted">رابط الدعوة هذا غير صالح.</p>
        ) : preview.data && (
          <>
            <h1 className="mt-8 text-xl font-bold">الانضمام إلى {preview.data.workspaceName}</h1>
            <p className="mt-2 text-sm text-muted">وصلتك دعوة بصلاحية <b>{roleLabel[preview.data.role]}</b> (<span dir="ltr">{preview.data.email}</span>).</p>
            {preview.data.expired ? <p className="mt-6 text-sm text-danger">انتهت صلاحية الدعوة. اطلب دعوة جديدة.</p>
              : preview.data.accepted ? <p className="mt-6 text-sm text-muted">هذه الدعوة استُخدمت من قبل.</p>
              : me && me.email.toLowerCase() !== preview.data.email.toLowerCase()
                ? <p className="mt-6 text-sm text-danger">أنت مسجّل دخول بـ <span dir="ltr">{me.email}</span>. سجّل الدخول بـ <span dir="ltr">{preview.data.email}</span> عشان تقبل الدعوة.</p>
                : (
                  <div className="mt-6 space-y-3">
                    <ErrorNote error={accept.error} />
                    <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>قبول والانضمام</Button>
                  </div>
                )}
          </>
        )}
      </div>
    </div>
  )
}

const nav = [
  { to: '', label: 'لوحة المؤشرات', icon: LayoutDashboard, end: true },
  { to: 'board', label: 'المهام', icon: KanbanSquare },
  { to: 'analytics', label: 'التحليلات', icon: BarChart3 },
  { to: 'team', label: 'الفريق', icon: Users },
  { to: 'settings', label: 'الإعدادات', icon: Settings },
]

function Shell() {
  const { workspaceId } = useParams()
  const { data: ws, error, isLoading } = useWorkspace()
  const { me, signOut } = useAuth()
  const location = useLocation()
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  useRealtime(workspaceId!)

  useEffect(() => { if (ws) applyAccent(ws.accentColor) }, [ws])
  useEffect(() => {
    try { localStorage.setItem('tb.lastWorkspace', workspaceId!) } catch { /* storage blocked */ }
  }, [workspaceId])
  useEffect(() => setMenuOpen(false), [location.pathname])

  if (isLoading) return <PageLoader />
  if (error || !ws) return <Navigate to="/" replace />

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  const sidebar = (
    <aside className="flex h-full w-60 flex-col border-e border-line bg-surface p-4">
      <div className="mb-6 flex items-center justify-between px-1">
        <Logo />
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة"><X size={18} /></button>
      </div>
      <WorkspaceSwitcher current={ws} />
      <p className="mt-6 mb-2 px-3 text-xs font-semibold text-muted">القائمة</p>
      <nav className="space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label} to={to} end={end}
            className={({ isActive }) => clsx(
              'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold',
              isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-pill" className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-accent" />}
                <Icon size={18} /> {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto rounded-2xl bg-accent p-4 text-white">
        <p className="text-sm font-bold">التحقق الثنائي مفعّل</p>
        <p className="mt-1 text-xs text-white/85">باقي لك {me?.recoveryCodesLeft ?? 0} من رموز الاسترداد. تقدر تديرها من الإعدادات.</p>
      </div>
    </aside>
  )

  return (
    <div className="flex h-full">
      <div className="hidden lg:block">{sidebar}</div>
      <AnimatePresence>
        {menuOpen && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
            <motion.div className="relative h-full w-60" initial={{ x: 260 }} animate={{ x: 0 }} exit={{ x: 260 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><Menu size={20} /></button>
          <span className="truncate font-bold lg:hidden">{ws.name}</span>
          <div className="ms-auto flex items-center gap-1.5">
            <button onClick={toggleTheme} className="rounded-xl p-2.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="تبديل الوضع الليلي">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={theme} className="block" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </motion.span>
              </AnimatePresence>
            </button>
            {me && (
              <div className="flex items-center gap-2.5 rounded-xl py-1 ps-1 pe-2">
                <Avatar name={me.displayName} color={me.avatarColor} size={32} />
                <div className="hidden text-xs leading-tight sm:block">
                  <p className="font-bold">{me.displayName}</p>
                  <p className="text-muted" dir="ltr">{me.email}</p>
                </div>
              </div>
            )}
            <button onClick={signOut} className="rounded-xl p-2.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const { data } = useWorkspaces()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-start hover:bg-surface-2" aria-expanded={open}>
        <span className="grid size-7 place-items-center rounded-lg text-xs font-extrabold text-white" style={{ background: current.accentColor }}>{current.name[0]?.toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{current.name}</span>
        <ChevronDown size={16} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
          >
            {data?.map(w => (
              <button key={w.id} onClick={() => { setOpen(false); navigate(`/w/${w.id}`) }}
                className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-surface-2', w.id === current.id && 'font-bold')}>
                <span className="size-2.5 rounded-full" style={{ background: w.accentColor }} />
                <span className="truncate">{w.name}</span>
                <span className="ms-auto text-[11px] text-muted">{roleLabel[w.role]}</span>
              </button>
            ))}
            <button onClick={() => { setOpen(false); navigate('/new') }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-accent hover:bg-surface-2">
              <Plus size={16} /> مساحة عمل جديدة
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
