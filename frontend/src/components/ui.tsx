import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { animate, AnimatePresence, motion, useInView } from 'motion/react'
import { X } from './icons'
import clsx from 'clsx'
import { num } from '../lib/i18n'

export function Button({
  variant = 'primary', size = 'md', className, loading, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md'; loading?: boolean
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed active:scale-[.98] transition-transform',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong shadow-sm',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-surface-2',
        variant === 'outline' && 'border border-line bg-surface hover:bg-surface-2',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
    >
      {loading && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, error, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string; hint?: string
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        {...rest}
        className={clsx(
          'h-10 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-muted/70',
          'focus:border-accent focus:ring-4 focus:ring-accent-soft',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

export function Card({ className, children, title, subtitle, action }: {
  className?: string; children: ReactNode; title?: string; subtitle?: string; action?: ReactNode
}) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-surface p-5 shadow-card', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-bold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Avatar({ name, color, size = 28, className }: { name: string; color: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]!.toUpperCase()).join('')
  return (
    <span
      title={name}
      className={clsx('inline-grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-surface', className)}
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  )
}

/** Counts up from zero when it scrolls into view, like the numbers in the reference video. */
export function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const from = useRef(0)
  useEffect(() => {
    if (!inView || !ref.current) return
    const node = ref.current
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: v => { node.textContent = num(v, decimals) + suffix },
    })
    from.current = value
    return () => controls.stop()
  }, [inView, value, decimals, suffix])
  return <span ref={ref} className="tabular-nums">0{suffix}</span>
}

export function Modal({ open, onClose, children, title, wide }: {
  open: boolean; onClose: () => void; children: ReactNode; title?: string; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className={clsx('relative w-full rounded-2xl border border-line bg-surface p-6 shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <button onClick={onClose} aria-label="إغلاق" className="absolute end-4 top-4 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
              <X size={18} />
            </button>
            {title && <h2 className="mb-5 pe-8 text-lg font-bold">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', className)}
      style={color ? { background: `color-mix(in oklab, ${color} 15%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block size-5 rounded-full border-2 border-accent border-r-transparent animate-spin', className)} />
}

export function PageLoader() {
  return <div className="grid h-64 place-items-center"><Spinner /></div>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
      {error instanceof Error ? (error.message.startsWith('Failed to fetch') ? 'تعذّر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.' : error.message) : String(error)}
    </div>
  )
}

/** A short-lived message at the bottom of the screen. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(t)
  }, [msg])
  const node = (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg shadow-lg"
        >
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
  return { toast: setMsg, toastNode: node }
}

export const priorityColor: Record<string, string> = {
  Low: '#64748b', Medium: '#0ea5e9', High: '#f97316', Urgent: '#ef4444',
}
