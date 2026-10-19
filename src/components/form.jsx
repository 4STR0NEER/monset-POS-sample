import { motion } from 'motion/react'
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { EASE_OUT } from './ui.jsx'

// Shared form pieces for the admin screens (light surfaces).
export const field = 'h-11 w-full rounded-lg bg-paper px-3 ring-1 ring-ink/15 outline-none transition-shadow duration-150 placeholder:text-smoke/70 focus:ring-2 focus:ring-gold disabled:bg-mist disabled:text-smoke'
export const label = 'block text-sm font-semibold'

export function Problem({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/10 px-3 py-2.5 text-sm font-semibold text-crimson">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </p>
  )
}

export function Notice({ children }) {
  return (
    <motion.p role="status" className="flex items-start gap-2 rounded-lg bg-active/12 px-3 py-2.5 text-sm font-semibold text-[#0B6B35]" initial={{ opacity: 0, transform: 'translateY(-6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, ease: EASE_OUT }}>
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </motion.p>
  )
}

export function Submit({ busy, children, disabled, tone = 'bg-ink text-paper', type = 'submit', onClick }) {
  return (
    <button type={type} onClick={onClick} disabled={busy || disabled} className={`press flex h-12 w-full items-center justify-center gap-2 rounded-xl font-display text-xl font-black uppercase tracking-[0.03em] disabled:opacity-40 ${tone}`}>
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

// ₱-prefixed money text input.
export function MoneyField({ value, onChange, className = '', ...rest }) {
  return (
    <span className={`relative block ${className}`}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
      <input inputMode="decimal" autoComplete="off" value={value} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && onChange(e.target.value)} className={`${field} tabular pl-7`} {...rest} />
    </span>
  )
}

export function StatusPill({ tone, Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      {Icon && <Icon className="size-3.5" aria-hidden="true" />} {children}
    </span>
  )
}
