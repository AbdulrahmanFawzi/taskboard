import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight, X } from './icons'
import { LOCALE } from '../lib/i18n'

/** Saudi week: Sunday first; Friday and Saturday are days off and drawn muted. */
const weekdays = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const isWeekend = (d: Date) => d.getDay() === 5 || d.getDay() === 6

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }

/**
 * A calendar dropdown for picking one day. `value` and `onChange` use yyyy-mm-dd, or null for
 * no date. Clicking anywhere on the field opens it; Escape or a click outside closes it.
 */
export function DatePicker({ value, onChange, disabled, label }: {
  value: string | null; onChange: (v: string | null) => void; disabled?: boolean; label: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? parse(value) : null
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [month, setMonth] = useState(() => { const d = selected ?? today; return new Date(d.getFullYear(), d.getMonth(), 1) })
  const root = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !pop.current?.contains(t)) setOpen(false)
    }
    // The calendar floats over the page; if the page scrolls under it, just close it.
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    // Escape closes the calendar only, not the dialog around it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const toggle = () => {
    if (disabled) return
    if (!open) {
      const d = selected ?? today
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
      // Drawn in a portal so the dialog's scroll area cannot clip it: line its start edge up with
      // the field, and open upwards when there is not room below.
      const r = root.current!.getBoundingClientRect()
      const width = 288, height = 350, gap = 6
      const right = Math.min(window.innerWidth - 8, r.right)
      const below = window.innerHeight - r.bottom > height + gap
      setPlace({
        position: 'fixed', width, left: Math.max(8, right - width),
        ...(below ? { top: r.bottom + gap } : { bottom: window.innerHeight - r.top + gap }),
      })
    }
    setOpen(o => !o)
  }
  const pick = (d: Date | null) => { onChange(d ? iso(d) : null); setOpen(false) }

  const cells: (Date | null)[] = []
  for (let i = 0; i < month.getDay(); i++) cells.push(null)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))

  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div ref={root} className="relative">
      <div
        role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggle() } }}
        className={clsx(
          'flex h-9 w-full items-center gap-2 rounded-md border bg-surface px-2 text-sm outline-none',
          open ? 'border-accent ring-4 ring-accent-soft' : 'border-line-strong',
          disabled ? 'cursor-default opacity-70' : 'cursor-pointer hover:border-accent',
        )}
      >
        <CalendarDays size={16} className="shrink-0 text-muted" />
        <span className={clsx('flex-1 truncate', !selected && 'text-muted')}>
          {selected ? selected.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'اختر التاريخ'}
        </span>
        {selected && !disabled && (
          <button type="button" onClick={e => { e.stopPropagation(); pick(null) }} aria-label="مسح التاريخ"
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-danger"><X size={14} /></button>
        )}
      </div>

      {createPortal(<AnimatePresence>
        {open && (
          <motion.div
            ref={pop} style={place} dir="rtl"
            role="dialog" aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="z-[70] rounded-2xl border border-line bg-surface p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              {/* Right-to-left: the right arrow goes back a month, the left one forward. */}
              <button type="button" onClick={() => shift(-1)} aria-label="الشهر السابق" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronRight size={18} /></button>
              <span className="text-sm font-bold">{month.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}</span>
              <button type="button" onClick={() => shift(1)} aria-label="الشهر التالي" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronLeft size={18} /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {weekdays.map((w, i) => (
                <span key={w} className={clsx('py-1 text-[11px] font-semibold', i >= 5 ? 'text-muted/60' : 'text-muted')}>{w}</span>
              ))}
              {cells.map((d, i) => {
                if (!d) return <span key={`e${i}`} />
                const isSel = selected && iso(d) === iso(selected)
                const isToday = iso(d) === iso(today)
                return (
                  <button
                    key={iso(d)} type="button" onClick={() => pick(d)}
                    aria-label={d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}
                    aria-pressed={!!isSel}
                    className={clsx(
                      'grid aspect-square place-items-center rounded-md text-sm tabular-nums',
                      isSel ? 'bg-accent font-bold text-white'
                        : isToday ? 'font-bold text-accent ring-1 ring-accent ring-inset hover:bg-accent-soft'
                        : isWeekend(d) ? 'text-muted/60 hover:bg-surface-2'
                        : 'hover:bg-surface-2',
                    )}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button type="button" onClick={() => pick(today)} className="rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft">اليوم</button>
              {selected && <button type="button" onClick={() => pick(null)} className="rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-danger">بدون تاريخ</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
