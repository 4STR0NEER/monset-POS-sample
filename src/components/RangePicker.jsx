import { motion } from 'motion/react'
import { manilaToday } from '../lib/util.js'

// ---- Dates (all Manila calendar days, as 'YYYY-MM-DD') ----
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
export const monthStart = (d) => d.slice(0, 8) + '01'
export const fmtDay = (d, o = { month: 'short', day: 'numeric' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })

export function presets() {
  const t = manilaToday()
  const lmEnd = addDays(monthStart(t), -1)
  return [
    ['today', 'Today', t, t],
    ['7d', '7 days', addDays(t, -6), t],
    ['30d', '30 days', addDays(t, -29), t],
    ['month', 'This month', monthStart(t), t],
    ['lastmonth', 'Last month', monthStart(lmEnd), lmEnd],
    ['year', 'This year', t.slice(0, 4) + '-01-01', t],
  ]
}


// Preset chips plus native from/to date inputs. range: { key, from, to } as 'YYYY-MM-DD'.
export default function RangePicker({ opts, range, setRange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-paper p-1 ring-1 ring-ink/5" role="group" aria-label="Date range">
        {opts.map(([key, label, from, to]) => (
          <button key={key} type="button" aria-pressed={range.key === key} onClick={() => setRange({ key, from, to })} className="press relative h-9 shrink-0 rounded-md px-3 text-sm font-semibold">
            {range.key === key && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-md bg-ink" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
            <span className={`relative transition-colors duration-150 ${range.key === key ? 'text-paper' : 'text-smoke hover:text-ink'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <label className="sr-only" htmlFor="from">
          From
        </label>
        <input id="from" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ key: 'custom', from: e.target.value, to: range.to })} className="tabular h-11 rounded-lg bg-paper px-2.5 ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-gold" />
        <span className="text-smoke">to</span>
        <label className="sr-only" htmlFor="to">
          To
        </label>
        <input id="to" type="date" value={range.to} min={range.from} max={manilaToday()} onChange={(e) => e.target.value && setRange({ key: 'custom', from: range.from, to: e.target.value })} className="tabular h-11 rounded-lg bg-paper px-2.5 ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-gold" />
      </div>
    </div>
  )
}

