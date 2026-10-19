import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { motion } from 'motion/react'
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from '../components/icons'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { InvitationPreview, LoginResponse, Me, TwoFactorSetup } from '../lib/types'
import { Button, ErrorNote, Field } from '../components/ui'
import { identityErrors } from '../lib/i18n'

/**
 * Jeddah Municipality (أمانة جدة) logo, from jeddah.gov.sa. The dark file swaps the navy
 * lettering for white so it stays readable on dark surfaces; `compact` shows the emblem only.
 */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  const file = compact ? 'amanah-mark' : 'amanah-logo'
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <img src={`/brand/${file}.svg`} alt="أمانة جدة" className={`dark:hidden ${compact ? 'size-9' : 'h-11 w-auto'}`} />
      <img src={`/brand/${file}-dark.svg`} alt="أمانة جدة" className={`hidden dark:block ${compact ? 'size-9' : 'h-11 w-auto'}`} />
      {!compact && (
        <span className="border-s border-line ps-2.5 text-sm font-bold leading-tight">لوحة<br />المهام</span>
      )}
    </span>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <motion.div
          className="m-auto w-full max-w-sm py-10"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1.5 mb-7 text-sm text-muted">{subtitle}</p>
          {children}
        </motion.div>
      </div>
      <div className="relative hidden overflow-hidden bg-accent lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/.25),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <BoardIllustration />
          <p className="mt-10 text-3xl font-bold leading-tight">خطّط، تابع،<br />وأنجز.</p>
          <p className="mt-3 max-w-md text-white/85">لوحات مهام ومؤشرات وتحليلات للفريق كامل، بدخول محمي بالتحقق الثنائي.</p>
        </div>
      </div>
    </div>
  )
}

function BoardIllustration() {
  const cols = [[60, 40, 52], [48, 64], [56], [40, 50, 36]]
  return (
    <div className="flex gap-3">
      {cols.map((cards, i) => (
        <div key={i} className="w-36 rounded-2xl bg-white/12 p-2.5 backdrop-blur">
          <div className="mb-2.5 h-2 w-14 rounded-full bg-white/50" />
          {cards.map((h, j) => (
            <motion.div
              key={j}
              className="mb-2 rounded-xl bg-white/90 p-2.5 shadow-sm"
              style={{ height: h }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.08 + j * 0.06, type: 'spring', stiffness: 260, damping: 24 }}
            >
              <div className="h-1.5 w-3/4 rounded-full bg-black/15" />
              <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-black/10" />
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Where to go after signing in: the `next` path from the query (an invite link, say), or home. */
export function nextPath(search: string) {
  const next = new URLSearchParams(search).get('next')
  // Only follow same-site paths, never a full URL from the query string.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function useAfterLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  return () => navigate(nextPath(location.search), { replace: true })
}

export function LoginPage() {
  const { setMe } = useAuth()
  const done = useAfterLogin()
  const location = useLocation()
  const [step, setStep] = useState<'password' | 'code' | 'recovery'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [rememberMachine, setRememberMachine] = useState(false)

  const finish = (r: LoginResponse) => {
    if (r.requiresTwoFactor) { setStep('code'); return }
    setMe(r.user)
    done()
  }

  const login = useMutation({
    mutationFn: () => api.post<LoginResponse>('/api/auth/login', { email, password }),
    onSuccess: finish,
  })
  const verify = useMutation({
    mutationFn: () => step === 'code'
      ? api.post<LoginResponse>('/api/auth/login/2fa', { code, rememberMachine })
      : api.post<LoginResponse>('/api/auth/login/recovery', { recoveryCode: code }),
    onSuccess: finish,
    onError: e => { if (e instanceof ApiError && e.status === 401) { setStep('password'); setCode('') } },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step === 'password') login.mutate()
    else verify.mutate()
  }

  if (step !== 'password') {
    return (
      <AuthShell
        title={step === 'code' ? 'أدخل رمز التحقق' : 'استخدم رمز استرداد'}
        subtitle={step === 'code'
          ? 'افتح تطبيق المصادقة واكتب الرمز المكوّن من 6 أرقام الخاص بلوحة المهام.'
          : 'اكتب أحد رموز الاسترداد اللي حفظتها وقت تفعيل التحقق الثنائي. كل رمز يشتغل مرة وحدة.'}
      >
        <form onSubmit={submit} className="space-y-4">
          {step === 'code' ? (
            <CodeInput value={code} onChange={setCode} autoFocus />
          ) : (
            <Field label="رمز الاسترداد" value={code} onChange={e => setCode(e.target.value)} autoFocus autoComplete="off" placeholder="xxxxx-xxxxx" />
          )}
          {step === 'code' && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={rememberMachine} onChange={e => setRememberMachine(e.target.checked)} className="accent-[var(--accent)]" />
              لا تطلب الرمز في هذا الجهاز لمدة 30 يومًا
            </label>
          )}
          <ErrorNote error={verify.error} />
          <Button className="w-full" loading={verify.isPending} disabled={step === 'code' ? code.length !== 6 : code.length < 6}>
            تحقق وسجّل الدخول
          </Button>
          <button type="button" onClick={() => { setCode(''); setStep(step === 'code' ? 'recovery' : 'code') }}
            className="w-full text-center text-sm font-semibold text-accent hover:underline">
            {step === 'code' ? 'فقدت جوالك؟ استخدم رمز استرداد' : 'استخدم تطبيق المصادقة بدلًا من ذلك'}
          </button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="أهلًا بعودتك" subtitle="سجّل الدخول إلى مساحة عملك.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="البريد الإلكتروني" type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        <Field label="كلمة المرور" type="password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        <ErrorNote error={login.error} />
        <Button className="w-full" loading={login.isPending}>متابعة</Button>
        <p className="text-center text-sm text-muted">
          {inviteToken(location.search)
            ? <>جديد هنا؟ <Link to={`/register${location.search}`} className="font-semibold text-accent hover:underline">أنشئ حسابًا</Link></>
            : 'الحسابات الجديدة تُنشأ برابط دعوة من مشرف مساحة العمل.'}
        </p>
      </form>
    </AuthShell>
  )
}

/** The invitation token when sign-in was reached from an invite link (?next=/invite/<token>). */
export function inviteToken(search: string) {
  return /^\/invite\/([0-9a-f]+)$/.exec(nextPath(search))?.[1] ?? null
}

export function RegisterPage() {
  const { setMe } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const token = inviteToken(location.search)
  const [form, setForm] = useState({ displayName: '', email: '', password: '' })
  // Sign-up is by invitation: show who invited them and fix the email to the invited one.
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitationPreview>(`/api/invitations/${token}`),
    enabled: !!token,
    retry: false,
  })
  useEffect(() => {
    if (invite.data) setForm(f => ({ ...f, email: invite.data.email }))
  }, [invite.data])
  const register = useMutation({
    mutationFn: () => api.post<Me>('/api/auth/register', { ...form, inviteToken: token }),
    onSuccess: me => { setMe(me); navigate(`/setup-2fa${location.search}`, { replace: true }) },
  })
  const fields = register.error instanceof ApiError ? register.error.fields : {}
  const fieldError = (...names: string[]) => names.map(n => fields[n] ? identityErrors[n] ?? fields[n]![0] : undefined).find(Boolean)

  return (
    <AuthShell
      title="إنشاء حساب"
      subtitle={invite.data
        ? `وصلتك دعوة للانضمام إلى ${invite.data.workspaceName}. بعد إنشاء الحساب بتفعّل التحقق الثنائي.`
        : 'بعدها مباشرة بتفعّل التحقق الثنائي.'}
    >
      {!token && (
        <div className="mb-5 rounded-xl border border-line bg-surface-2 p-3.5 text-sm text-muted">
          التسجيل في المنصة يكون برابط دعوة من مشرف مساحة العمل. إذا وصلك رابط، افتحه وأكمل التسجيل من خلاله.
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); register.mutate() }} className="space-y-4">
        <Field label="الاسم" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} required minLength={2} autoFocus autoComplete="name" />
        <Field label="البريد الإلكتروني للعمل" type="email" dir="ltr" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required autoComplete="email"
          readOnly={!!invite.data} hint={invite.data ? 'البريد اللي وصلته الدعوة.' : undefined}
          error={fieldError('DuplicateEmail', 'DuplicateUserName', 'Email')} />
        <Field label="كلمة المرور" type="password" dir="ltr" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={10} autoComplete="new-password"
          hint="10 أحرف على الأقل. جملة قصيرة تكون كلمة مرور ممتازة." error={fieldError('PasswordTooShort', 'PasswordRequiresUniqueChars', 'Password')} />
        {Object.keys(fields).length === 0 && <ErrorNote error={register.error} />}
        <Button className="w-full" loading={register.isPending}>إنشاء الحساب</Button>
        <p className="text-center text-sm text-muted">
          عندك حساب؟ <Link to={`/login${location.search}`} className="font-semibold text-accent hover:underline">سجّل الدخول</Link>
        </p>
      </form>
    </AuthShell>
  )
}

/** Six boxes that behave like one field, including paste of the whole code. */
export function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">الرمز (6 أرقام)</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" autoFocus={autoFocus} dir="ltr"
        aria-label="الرمز (6 أرقام)"
        className="h-14 w-full rounded-md border border-line-strong bg-surface text-center font-mono text-2xl tracking-[.6em] outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft"
        placeholder="••••••"
      />
    </label>
  )
}

export function TwoFactorSetupPage() {
  const { me, setMe } = useAuth()
  const done = useAfterLogin()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  const setup = useQuery({
    queryKey: ['2fa-setup'],
    queryFn: () => api.post<TwoFactorSetup>('/api/auth/2fa/setup'),
    enabled: !!me && !me.twoFactorEnabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/2fa/enable', { code }),
    onSuccess: r => setCodes(r.recoveryCodes),
  })

  const finish = async () => {
    setMe(await api.get<Me>('/api/auth/me'))
    done()
  }

  if (codes) {
    const text = codes.join('\n')
    return (
      <AuthShell title="احفظ رموز الاسترداد" subtitle="لو فقدت جوالك، كل رمز من هذي يدخّلك مرة وحدة. احفظها في مكان آمن مثل مدير كلمات المرور.">
        <div dir="ltr" className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface-2 p-4 font-mono text-sm">
          {codes.map(c => <span key={c}>{c}</span>)}
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { navigator.clipboard.writeText(text); setCopied(true) }}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'تم النسخ' : 'نسخ'}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
            a.download = 'taskboard-recovery-codes.txt'
            a.click()
          }}>تنزيل</Button>
        </div>
        <Button className="mt-6 w-full" onClick={finish}>حفظتها، متابعة</Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="فعّل التحقق الثنائي" subtitle="مطلوب لكل حساب في هذه المنصة، ويأخذ دقيقة.">
      <ol className="space-y-5">
        <Step n={1} icon={<Smartphone size={16} />} title="نزّل تطبيق مصادقة">
          Google Authenticator أو Microsoft Authenticator أو أي تطبيق يدعم TOTP.
        </Step>
        <Step n={2} icon={<KeyRound size={16} />} title="امسح الرمز">
          {setup.isLoading && <div className="mt-3 size-44 animate-pulse rounded-xl bg-surface-2" />}
          <ErrorNote error={setup.error} />
          {setup.data && (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="rounded-xl bg-white p-3"><QRCodeSVG value={setup.data.authenticatorUri} size={148} /></div>
              <div className="min-w-0 text-xs text-muted">
                ما قدرت تمسح؟ أدخل هذا المفتاح:
                <code dir="ltr" className="mt-1 block break-all rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-ink">{setup.data.sharedKey}</code>
              </div>
            </div>
          )}
        </Step>
        <Step n={3} icon={<ShieldCheck size={16} />} title="اكتب الرمز اللي يظهر لك">
          <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); enable.mutate() }}>
            <CodeInput value={code} onChange={setCode} />
            <ErrorNote error={enable.error} />
            <Button className="w-full" loading={enable.isPending} disabled={code.length !== 6 || !setup.data}>تفعيل</Button>
          </form>
        </Step>
      </ol>
    </AuthShell>
  )
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-label={`الخطوة ${n}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </li>
  )
}
