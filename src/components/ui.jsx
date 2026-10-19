import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import { X } from 'lucide-react'

export const EASE_OUT = [0.23, 1, 0.32, 1]

// Animates from the previous value to the new one; interruptible because it rides one motion value.
export function CountUp({ value, format = (v) => Math.round(v), duration = 0.5 }) {
  const ref = useRef(null)
  const mv = useMotionValue(value)
  useEffect(() => {
    const c = animate(mv, value, { duration, ease: EASE_OUT })
    return () => c.stop()
  }, [mv, value, duration])
  useMotionValueEvent(mv, 'change', (v) => ref.current && (ref.current.textContent = format(v)))
  return <span ref={ref}>{format(value)}</span>
}

// Stock wording shared by the register and inventory. Always words, never colour alone.
export const stockOf = (p) =>
  p.kind === 'service'
    ? { key: 'service', label: 'Service', tone: 'text-smoke' }
    : p.stock_qty <= 0
      ? { key: 'out', label: 'Out of stock', tone: 'text-crimson' }
      : p.stock_qty <= p.reorder_level
        ? { key: 'low', label: `Low · ${p.stock_qty} left`, tone: 'text-[#7A5A00]' }
        : { key: 'ok', label: `${p.stock_qty} in stock`, tone: 'text-smoke' }

export const fmtDateTime = (t) =>
  new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Segmented control with a sliding pill; `id` must be unique on the page.
export function Segmented({ id, options, value, onChange, dark = false, className = '' }) {
  return (
    <div role="tablist" className={`flex gap-1 rounded-lg p-1 ${dark ? 'bg-ink-2' : 'bg-mist'} ${className}`}>
      {options.map(([v, label, Icon]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)} className="press relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap">
          {value === v && <motion.span layoutId={id} className={`absolute inset-0 rounded-md ${dark ? 'bg-gold' : 'bg-paper shadow-[0_1px_3px_rgb(25_23_27/0.15)]'}`} transition={{ type: 'spring', duration: 0.25, bounce: 0.1 }} />}
          {Icon && <Icon className="relative size-4" aria-hidden="true" />}
          <span className={`relative transition-colors duration-150 ${value === v ? 'text-ink' : dark ? 'text-ash' : 'text-smoke'}`}>{label}</span>
        </button>
      ))}
    </div>
  )
}

// Right-side panel over a dimmed page, full width on phones. Esc or the backdrop closes it.
// Render inside <AnimatePresence> so it slides out too.
export function Sheet({ title, subtitle, onClose, header, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <motion.div className="fixed inset-0 z-40" initial="out" animate="in" exit="out">
      <motion.div className="absolute inset-0 bg-ink/50" variants={{ out: { opacity: 0 }, in: { opacity: 1 } }} transition={{ duration: 0.2 }} onClick={onClose} aria-hidden="true" />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-mist shadow-[-16px_0_48px_-16px_rgb(0_0_0/0.45)] sm:w-[32rem]"
        variants={{ out: { transform: 'translateX(100%)' }, in: { transform: 'translateX(0%)' } }}
        transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
      >
        <header className="shrink-0 bg-ink px-5 pt-5 pb-4 text-paper short:pt-3 short:pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="sheet-title" className="truncate font-display text-3xl font-black uppercase leading-none">
                {title}
              </h2>
              {subtitle && <p className="mt-1 text-sm text-ash">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press grid size-10 shrink-0 place-items-center rounded-lg ring-1 ring-paper/10">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          {header}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</div>
      </motion.aside>
    </motion.div>
  )
}
