import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, CircleAlert, Download, FileText, Loader2, Minus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { money } from '../lib/util.js'
import RangePicker, { addDays, fmtDay, monthStart, presets } from '../components/RangePicker.jsx'
import { CountUp, EASE_OUT, Sheet } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'
import { downloadSalesReport, reportPeriods } from '../lib/reports.js'

// Validated (dataviz validator, light surface): cost/profit pair passes CVD + contrast. Same values as the marketing dashboard.
// Gold = profit and crimson = money out on every chart; sales lines are blue. The trio is validated too.
const C = { profit: '#A87800', cost: '#BA0021', sales: '#2F6FB0', one: '#A87800', grid: '#E4E2E6', axis: '#5E5A63', ink: '#19171B' }
const RAMP = ['#FFF7DD', '#FFE8A3', '#FED45E', '#FEBE10', '#D69B00', '#9C6F00'] // sequential gold, light -> dark
const MEMBERSHIP = 'Membership'
const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
const shortPeso = (v) => (v >= 1000 ? `₱${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : money(v))
const num = (v) => Number(v) || 0
const signed = (v) => (v < 0 ? '−' + money(-v) : money(v))

// Days for short ranges, weeks (from Monday) up to ~7 months, then months.
function bucketize(rows, keys, maxDays = 62) {
  const unit = rows.length <= maxDays ? 'day' : rows.length <= Math.max(210, maxDays) ? 'week' : 'month'
  const out = new Map()
  for (const r of rows) {
    const dow = (new Date(r.date + 'T00:00:00Z').getUTCDay() + 6) % 7
    const k = unit === 'day' ? r.date : unit === 'week' ? addDays(r.date, -dow) : monthStart(r.date)
    const b = out.get(k) ?? Object.fromEntries([['date', k], ...keys.map((x) => [x, 0])])
    keys.forEach((x) => (b[x] += num(r[x])))
    out.set(k, b)
  }
  const label = (d) => (unit === 'month' ? fmtDay(d, { month: 'short', year: '2-digit' }) : unit === 'week' ? `Wk of ${fmtDay(d)}` : fmtDay(d))
  return { unit, data: [...out.values()].map((b) => ({ ...b, label: label(b.date) })) }
}

const TABS = [
  ['General', '/analytics'],
  ['Merchandise', '/analytics/merchandise'],
  ['Memberships', '/analytics/memberships'],
  ['Staff', '/analytics/staff'],
]

export default function Analytics() {
  const opts = useMemo(presets, [])
  const [range, setRange] = useState({ key: '30d', from: opts[2][2], to: opts[2][3] })
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [pdf, setPdf] = useState(false)

  useEffect(() => {
    let live = true
    setError(null)
    supabase.rpc('sales_report', { p_from: range.from, p_to: range.to }).then(({ data, error }) => {
      if (!live) return
      if (error) setError(error.message)
      else setReport(data)
    })
    return () => (live = false)
  }, [range.from, range.to])

  const stale = report && (report.from !== range.from || report.to !== range.to)

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-5xl font-black uppercase leading-none">Analytics</h1>
          <p className="tabular mt-1 text-smoke">
            {range.from === range.to ? fmtDay(range.from, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : `${fmtDay(range.from, { month: 'long', day: 'numeric', year: 'numeric' })} – ${fmtDay(range.to, { month: 'long', day: 'numeric', year: 'numeric' })}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker opts={opts} range={range} setRange={setRange} />
          <button type="button" onClick={() => setPdf(true)} className="press flex h-11 items-center gap-2 rounded-lg bg-ink px-4 font-semibold text-paper">
            <Download className="size-4" aria-hidden="true" /> Download PDF
          </button>
        </div>
      </header>

      <nav aria-label="Analytics" className="mt-6 flex gap-1 overflow-x-auto border-b border-ink/10">
        {TABS.map(([label, to]) => (
          <NavLink key={label} to={to} end className="relative shrink-0 px-4 pt-1 pb-3 text-sm font-semibold">
            {({ isActive }) => (
              <>
                <span className={`transition-colors duration-150 ${isActive ? 'text-ink' : 'text-smoke hover:text-ink'}`}>{label}</span>
                {isActive && <motion.span layoutId="an-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> Couldn't load the report. {error}
        </p>
      )}
      {!report && !error && <Skeleton />}
      {report && (
        <div className={`transition-opacity duration-200 ${stale ? 'opacity-50' : ''}`} aria-busy={stale}>
          <Routes>
            <Route index element={<General r={report} />} />
            <Route path="merchandise" element={<Merchandise r={report} />} />
            <Route path="memberships" element={<Memberships r={report} />} />
            <Route path="staff" element={<Staff r={report} />} />
          </Routes>
        </div>
      )}
      <AnimatePresence>{pdf && <DownloadSheet key="pdf" range={range} onClose={() => setPdf(false)} />}</AnimatePresence>
    </main>
  )
}

// Weekly and monthly reports for the owner and auditors.
function DownloadSheet({ range, onClose }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const go = async ([key, , from, to, label]) => {
    setBusy(key)
    setErr(null)
    setDone(null)
    try {
      await downloadSalesReport({ from, to, label, by: profile?.full_name })
      setDone(label)
    } catch (e) {
      setErr(e.message ?? String(e))
    }
    setBusy(null)
  }
  return (
    <Sheet title="Download report" subtitle="A PDF for the owner, the board or the auditors." onClose={onClose}>
      <p className="text-sm text-smoke">
        Each report has the profit and loss with the previous period, key figures, sales by payment method, category, product, membership and staff, payroll paid, and every expense with its OR number. It ends with signature lines.
      </p>
      <ul className="mt-4 space-y-2">
        {reportPeriods(range).map((p) => (
          <li key={p[0]}>
            <button type="button" onClick={() => go(p)} disabled={busy !== null} className="press flex w-full items-center gap-3 rounded-xl bg-paper p-4 text-left ring-1 ring-ink/8 transition-shadow duration-150 hover:ring-ink/25 disabled:opacity-60">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-mist">
                {busy === p[0] ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <FileText className="size-5" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{p[1]}</span>
                <span className="tabular block truncate text-sm text-smoke">{p[4]}</span>
              </span>
              <Download className="size-4 shrink-0 text-smoke" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2" aria-live="polite">
        {done && <p className="text-sm font-semibold text-[#0B6B35]">Downloaded: {done}. Check your downloads folder.</p>}
        {err && <p role="alert" className="text-sm font-semibold text-crimson">Couldn't make the PDF. {err}</p>}
      </div>
    </Sheet>
  )
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading report" className="mt-6 space-y-6">
      <div className="skeleton h-32 rounded-xl bg-paper" />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="skeleton h-80 rounded-xl bg-paper xl:col-span-3" />
        <div className="skeleton h-80 rounded-xl bg-paper xl:col-span-2" />
      </div>
    </div>
  )
}

// ---- Building blocks ----

function Panel({ title, note, className = '', children, i = 0 }) {
  return (
    <motion.section
      className={`min-w-0 rounded-xl bg-paper p-5 ring-1 ring-ink/5 ${className}`}
      initial={{ opacity: 0, transform: 'translateY(12px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease: EASE_OUT }}
    >
      <h2 className="font-display text-2xl font-extrabold uppercase leading-none">{title}</h2>
      {note && <p className="mt-1 text-sm text-smoke">{note}</p>}
      <div className="mt-4">{children}</div>
    </motion.section>
  )
}

function Delta({ now, before, fmt = (v) => Math.round(v), upIsGood = true }) {
  if (!before && !now) return <span>No change vs previous period</span>
  if (!before) return <span>New vs previous period</span>
  const d = now - before
  const pct = Math.round((d / Math.abs(before)) * 100)
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus
  const good = d === 0 ? null : d > 0 === upIsGood
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={`size-3.5 ${good === null ? '' : good ? 'text-active' : 'text-crimson'}`} aria-hidden="true" />
      {d >= 0 ? '+' : '−'}
      {fmt(Math.abs(d))} ({pct >= 0 ? '+' : ''}
      {pct}%) vs previous period
    </span>
  )
}

function Kpis({ items }) {
  const four = items.length % 4 === 0
  return (
    <motion.dl
      className={`mt-6 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 ${four ? 'lg:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-6'}`}
      initial="out"
      animate="in"
      transition={{ staggerChildren: 0.04 }}
    >
      {items.map((k) => (
        <motion.div
          key={k.label}
          className={`border-ink/8 p-5 not-last:border-r max-md:[&:nth-child(2n)]:border-r-0 ${
            four
              ? 'md:max-lg:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(4n)]:border-r-0 max-lg:[&:nth-last-child(n+3)]:border-b lg:[&:nth-last-child(n+5)]:border-b'
              : 'md:max-xl:[&:nth-child(3n)]:border-r-0 max-xl:border-b'
          }`}
          variants={{ out: { opacity: 0 }, in: { opacity: 1, transition: { duration: 0.3, ease: EASE_OUT } } }}
        >
          <dt className="text-sm font-semibold text-smoke">{k.label}</dt>
          <dd className={`tabular mt-2 font-display font-black leading-none ${typeof k.value === 'number' ? 'text-3xl sm:text-4xl xl:text-[2.4rem]' : 'truncate text-2xl sm:text-3xl'} ${k.tone ?? ''}`} title={typeof k.value === 'number' ? undefined : k.value}>
            {typeof k.value === 'number' ? <CountUp value={k.value} format={k.fmt ?? ((v) => Math.round(v).toLocaleString('en-PH'))} duration={0.7} /> : k.value}
          </dd>
          <dd className="tabular mt-1.5 text-xs text-smoke">{k.note}</dd>
        </motion.div>
      ))}
    </motion.dl>
  )
}

const axis = { stroke: C.axis, fontSize: 12, tickLine: false, axisLine: false }

function Tip({ active, payload, label, fmt = (v) => v, total: showTotal = false }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + num(p.value), 0)
  return (
    <div className="rounded-lg bg-ink px-3 py-2 text-sm text-paper shadow-[0_8px_24px_-8px_rgb(0_0_0/0.5)]">
      <p className="text-xs text-ash">{payload[0]?.payload?.label ?? label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="tabular flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <b>{fmt(p.value)}</b>
        </p>
      ))}
      {showTotal && payload.length > 1 && (
        <p className="tabular mt-1 border-t border-paper/15 pt-1 text-ash">
          Sales: <b className="text-paper">{fmt(total)}</b>
        </p>
      )}
    </div>
  )
}

function Legend({ items }) {
  return (
    <p className="flex flex-wrap justify-end gap-4 text-sm text-smoke">
      {items.map(([n, c]) => (
        <span key={n} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: c }} aria-hidden="true" />
          {n}
        </span>
      ))}
    </p>
  )
}

function Empty({ children }) {
  return <p className="grid h-48 place-items-center px-6 text-center text-smoke">{children}</p>
}

// Revenue split into cost (bottom) and profit (top); bar height is the sale total.
function SalesChart({ rows }) {
  const { unit, data } = bucketize(rows, ['revenue', 'profit', 'receipts'])
  const chart = data.map((d) => ({ ...d, cost: Math.max(d.revenue - d.profit, 0), profit: Math.min(d.profit, d.revenue) }))
  if (!chart.some((d) => d.revenue)) return <Empty>No sales in this range yet.</Empty>
  return (
    <>
      <Legend items={[['Cost of goods', C.cost], ['Gross profit', C.profit]]} />
      <div className="mt-2 h-72">
        <ResponsiveContainer>
          <BarChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={unit === 'day' && chart.length > 20 ? 2 : '20%'}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} width={52} tickFormatter={shortPeso} />
            <Tooltip cursor={{ fill: 'rgb(25 23 27 / 0.05)' }} content={<Tip fmt={money} total />} />
            <Bar dataKey="cost" name="Cost of goods" stackId="s" fill={C.cost} stroke="#fff" strokeWidth={1} maxBarSize={40} animationDuration={700} />
            <Bar dataKey="profit" name="Gross profit" stackId="s" fill={C.profit} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={700} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-smoke hover:text-ink">View as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="tabular w-full text-left">
            <thead className="text-xs uppercase tracking-[0.08em] text-smoke">
              <tr>
                <th className="py-1.5 font-bold">{unit === 'day' ? 'Day' : unit === 'week' ? 'Week' : 'Month'}</th>
                <th className="py-1.5 text-right font-bold">Receipts</th>
                <th className="py-1.5 text-right font-bold">Sales</th>
                <th className="py-1.5 text-right font-bold">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data.map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5">{d.label}</td>
                  <td className="py-1.5 text-right">{d.receipts}</td>
                  <td className="py-1.5 text-right">{money(d.revenue)}</td>
                  <td className="py-1.5 text-right">{money(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

// One series, one colour; value labels at the bar end. rows: [{ name, value, note? }]
function HBars({ rows, fmt = money, height, color = C.one }) {
  if (!rows.length) return <Empty>Nothing sold in this range.</Empty>
  return (
    <div style={{ height: height ?? Math.max(120, rows.length * 40) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" {...axis} width={140} tick={{ fill: C.ink, fontSize: 13 }} />
          <Tooltip cursor={{ fill: 'rgb(25 23 27 / 0.05)' }} content={<Tip fmt={fmt} />} />
          <Bar dataKey="value" name="Value" fill={color} radius={[0, 4, 4, 0]} barSize={18} animationDuration={700}>
            <LabelList dataKey="value" position="right" fontSize={12} fill={C.ink} formatter={fmt} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_IDX = [1, 2, 3, 4, 5, 6, 0]
const HOURS = Array.from({ length: 16 }, (_, k) => k + 6) // 6 AM .. 9 PM
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`

function Heatmap({ hours }) {
  const [hover, setHover] = useState(null)
  const grid = DOW_IDX.map((d) => HOURS.map((h) => num(hours.find((x) => x.dow === d && x.hour === h)?.receipts)))
  const max = Math.max(1, ...grid.flat())
  const step = (v) => (v <= 0 ? null : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1e-9)))])
  if (!hours.length) return <Empty>No sales in this range yet.</Empty>
  return (
    <div>
      <p className="tabular h-5 text-sm font-semibold" aria-live="polite">
        {hover ? `${DOWS[hover.r]} ${hourLabel(HOURS[hover.c])}m · ${grid[hover.r][hover.c]} receipt${grid[hover.r][hover.c] === 1 ? '' : 's'}` : <span className="font-normal text-smoke">Hover a cell for the count</span>}
      </p>
      <div className="mt-2 grid grid-cols-[2.5rem_repeat(16,minmax(0,1fr))] gap-[2px]" role="table" aria-label="Receipts by day and hour">
        <span />
        {HOURS.map((h) => (
          <span key={h} className="pb-1 text-center text-[0.68rem] text-smoke">
            {h % 3 === 0 ? hourLabel(h) : ''}
          </span>
        ))}
        {grid.map((row, r) => (
          <div key={r} role="row" className="contents">
            <span role="rowheader" className="self-center text-xs font-semibold text-smoke">
              {DOWS[r]}
            </span>
            {row.map((v, c) => (
              <span
                key={c}
                role="cell"
                aria-label={`${DOWS[r]} ${hourLabel(HOURS[c])}m: ${v}`}
                onPointerEnter={() => setHover({ r, c })}
                onPointerLeave={() => setHover(null)}
                className={`aspect-[1.4] rounded-[3px] ${hover?.r === r && hover?.c === c ? 'ring-2 ring-ink' : ''}`}
                style={{ background: step(v) ?? 'var(--color-mist)' }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-smoke">
        Quiet
        <span className="flex">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-7 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} />
          ))}
        </span>
        Busy
      </div>
    </div>
  )
}

// Ranked table with an inline bar on the main measure.
function RankTable({ rows, cols, barKey }) {
  const max = Math.max(1, ...rows.map((r) => num(r[barKey])))
  if (!rows.length) return <Empty>Nothing sold in this range.</Empty>
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="tabular w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-ink/8 text-xs uppercase tracking-[0.08em] text-smoke">
          <tr>
            <th className="py-2 pl-5 font-bold">#</th>
            {cols.map((c) => (
              <th key={c.key} className={`py-2 font-bold ${c.num ? 'text-right' : ''} ${c.last ? 'pr-5' : 'pr-3'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="transition-colors duration-150 hover:bg-mist/60">
              <td className="w-10 py-2.5 pl-5 text-smoke">{i + 1}</td>
              {cols.map((c) => (
                <td key={c.key} className={`py-2.5 ${c.num ? 'text-right' : ''} ${c.last ? 'pr-5' : 'pr-3'}`}>
                  {c.key === barKey ? (
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-mist sm:block" aria-hidden="true">
                        <span className="block h-full rounded-full" style={{ width: `${(num(r[barKey]) / max) * 100}%`, background: C.one }} />
                      </span>
                      <b className="font-semibold">{c.fmt(r[c.key], r)}</b>
                    </span>
                  ) : c.fmt ? (
                    c.fmt(r[c.key], r)
                  ) : (
                    r[c.key]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–')

// ---- Tabs ----

// Net profit = sales − cost of goods − expenses (payroll included once it's recorded as expenses).
function General({ r }) {
  const t = r.totals
  const p = r.previous
  const ex = r.expenses
  const avg = t.receipts ? num(t.revenue) / t.receipts : 0
  const payTotal = r.payments.reduce((s, x) => s + num(x.total), 0)
  const net = num(t.gross_profit) - num(ex?.total)
  const prevNet = num(p.gross_profit) - num(ex?.previous)
  return (
    <>
      {!ex && (
        <p role="alert" className="mt-6 flex items-center gap-2 rounded-lg bg-gold/20 px-4 py-3 text-sm font-semibold text-[#6B4E00]">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> Expenses aren't in this report yet. In Supabase › SQL Editor, run supabase/006_expenses.sql, then refresh.
        </p>
      )}
      <Kpis
        items={[
          { label: 'Sales', value: num(t.revenue), fmt: money, note: <Delta now={num(t.revenue)} before={num(p.revenue)} fmt={money} /> },
          { label: 'Gross profit', value: num(t.gross_profit), fmt: money, note: `Sales minus cost of goods · ${pct(num(t.gross_profit), num(t.revenue))}` },
          { label: 'Expenses', value: num(ex?.total), fmt: money, note: <Delta now={num(ex?.total)} before={num(ex?.previous)} fmt={money} upIsGood={false} /> },
          { label: net < 0 ? 'Net loss' : 'Net profit', value: net, fmt: signed, tone: net < 0 ? 'text-crimson' : '', note: <Delta now={net} before={prevNet} fmt={money} /> },
          { label: 'Receipts', value: t.receipts, note: <Delta now={t.receipts} before={p.receipts} /> },
          { label: 'Average sale', value: avg, fmt: money, note: `${(t.receipts ? num(t.items) / t.receipts : 0).toFixed(1)} items per receipt` },
          { label: 'Discounts given', value: num(t.discounts), fmt: money, note: `${pct(num(t.discounts), num(t.revenue) + num(t.discounts))} of list price` },
          { label: 'Voided', value: r.voids.count, note: r.voids.count ? `${money(r.voids.total)} reversed` : 'No voids' },
        ]}
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Money in and out" note="Net profit is sales minus the cost of goods sold minus expenses" className="xl:col-span-5" i={0}>
          <MoneyLines rows={r.daily} />
        </Panel>
        <Panel title="Sales over time" note="Each bar is the sale total, split into what the goods cost and the profit kept" className="xl:col-span-3" i={1}>
          <SalesChart rows={r.daily} />
        </Panel>
        <Panel title="Expenses by category" note={ex?.by_category.length ? `${money(ex.total)} in this range` : null} className="xl:col-span-2" i={2}>
          {ex?.by_category.length ? <HBars rows={ex.by_category.map((x) => ({ name: x.category, value: num(x.total) }))} color={C.cost} /> : <Empty>No expenses recorded in this range.</Empty>}
        </Panel>
        <Panel title="Busiest hours" note="Receipts by day and hour, whole range" className="xl:col-span-3" i={3}>
          <Heatmap hours={r.hours} />
        </Panel>
        <Panel title="How customers paid" note={payTotal ? 'Share of sales by payment method' : null} className="xl:col-span-2" i={4}>
          <HBars rows={r.payments.map((x) => ({ name: `${METHOD[x.method] ?? x.method} · ${pct(num(x.total), payTotal)}`, value: num(x.total) }))} />
        </Panel>
        <Panel title="Sales by category" note="Before receipt discounts" className="xl:col-span-5" i={5}>
          <HBars rows={r.categories.map((x) => ({ name: x.category, value: num(x.revenue) }))} />
        </Panel>
      </div>
    </>
  )
}

const LINES = [
  ['revenue', 'Sales', C.sales],
  ['expenses', 'Expenses', C.cost],
  ['net', 'Net profit', C.profit],
]

// Three lines on one ₱ axis, a zero line for losses, and each line's latest value labelled at its end.
function MoneyLines({ rows }) {
  // Days only up to two weeks: rent and bills land on single days, so daily net profit swings misleadingly.
  const { unit, data } = bucketize(rows, ['revenue', 'profit', 'expenses'], 14)
  const chart = data.map((d) => ({ ...d, net: d.profit - d.expenses }))
  if (!chart.some((d) => d.revenue || d.expenses)) return <Empty>No sales or expenses in this range yet.</Empty>
  const last = chart.length - 1
  const fmtAxis = (v) => (v < 0 ? '−' + shortPeso(-v) : shortPeso(v))
  const endLabel = (props) =>
    props.index === last ? (
      <text x={props.x + 8} y={props.y} dy={4} fontSize={12} fontWeight={600} fill={C.ink}>
        {fmtAxis(props.value)}
      </text>
    ) : null
  return (
    <>
      <Legend items={LINES.map(([, n, c]) => [n, c])} />
      <div className="mt-2 h-80">
        <ResponsiveContainer>
          <LineChart data={chart} margin={{ top: 12, right: 64, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} width={56} tickFormatter={fmtAxis} />
            <ReferenceLine y={0} stroke={C.axis} strokeWidth={1} />
            <Tooltip cursor={{ stroke: C.axis, strokeDasharray: '3 3' }} content={<Tip fmt={signed} />} />
            {LINES.map(([key, name, color]) => (
              <Line
                key={key}
                type="linear"
                dataKey={key}
                name={name}
                stroke={color}
                strokeWidth={2}
                dot={chart.length <= 14 ? { r: 4, fill: color, stroke: '#fff', strokeWidth: 2 } : false}
                activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                animationDuration={800}
                label={endLabel}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-smoke">Grouped by {unit}. Expenses count on the day they were paid.</p>
    </>
  )
}

function Merchandise({ r }) {
  const [sort, setSort] = useState('revenue')
  const items = r.products.filter((x) => x.category !== MEMBERSHIP)
  const cats = r.categories.filter((x) => x.category !== MEMBERSHIP)
  const revenue = items.reduce((s, x) => s + num(x.revenue), 0)
  const profit = items.reduce((s, x) => s + num(x.profit), 0)
  const units = items.reduce((s, x) => s + num(x.units), 0)
  const top = items[0]
  const daily = r.daily.map((d) => ({ date: d.date, revenue: r.category_daily.filter((x) => x.date === d.date && x.category !== MEMBERSHIP).reduce((s, x) => s + num(x.revenue), 0) }))
  const sorted = [...items].sort((a, b) => num(b[sort]) - num(a[sort]))
  return (
    <>
      <Kpis
        items={[
          { label: 'Merchandise sales', value: revenue, fmt: money, note: `${pct(revenue, num(r.totals.revenue) + num(r.totals.discounts))} of all sales` },
          { label: 'Merchandise profit', value: profit, fmt: money, note: `${pct(profit, revenue)} margin` },
          { label: 'Units sold', value: units, note: `${items.length} different products` },
          { label: 'Best seller', value: top ? top.name : '–', note: top ? `${money(top.revenue)} · ${top.units} sold` : 'No sales yet' },
        ]}
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Merchandise sales" note="Before receipt discounts" className="xl:col-span-3" i={0}>
          <OneSeries rows={daily} name="Sales" />
        </Panel>
        <Panel title="By category" className="xl:col-span-2" i={1}>
          <HBars rows={cats.map((x) => ({ name: x.category, value: num(x.revenue) }))} />
        </Panel>
        <Panel title="Products" note="Ranked by the column you pick" className="xl:col-span-5" i={2}>
          <div className="mb-3 flex gap-1" role="group" aria-label="Sort by">
            {[
              ['revenue', 'Sales'],
              ['units', 'Units'],
              ['profit', 'Profit'],
            ].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`press h-9 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${sort === k ? 'bg-ink text-paper' : 'text-smoke ring-1 ring-ink/10 hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
          <RankTable
            rows={sorted.map((x) => ({ ...x, id: x.product_id }))}
            barKey={sort}
            cols={[
              { key: 'name', label: 'Product', fmt: (v, x) => (<span><b className="font-semibold">{v}</b> <span className="text-smoke">· {x.category}</span></span>) },
              { key: 'units', label: 'Units', num: true, fmt: (v) => num(v).toLocaleString('en-PH') },
              { key: 'revenue', label: 'Sales', num: true, fmt: money },
              { key: 'profit', label: 'Profit', num: true, fmt: money },
              { key: 'margin', label: 'Margin', num: true, last: true, fmt: (_, x) => pct(num(x.profit), num(x.revenue)) },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}

function OneSeries({ rows, name, field = 'revenue', fmt = money }) {
  const { data } = bucketize(rows, [field])
  if (!data.some((d) => d[field])) return <Empty>No sales in this range yet.</Empty>
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={data.length > 20 ? 2 : '20%'}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axis} minTickGap={24} />
          <YAxis {...axis} width={52} tickFormatter={fmt === money ? shortPeso : undefined} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgb(25 23 27 / 0.05)' }} content={<Tip fmt={fmt} />} />
          <Bar dataKey={field} name={name} fill={C.one} radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={700} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Memberships({ r }) {
  const plans = r.products.filter((x) => x.category === MEMBERSHIP)
  const sold = plans.reduce((s, x) => s + num(x.units), 0)
  const revenue = plans.reduce((s, x) => s + num(x.revenue), 0)
  const allLines = r.categories.reduce((s, x) => s + num(x.revenue), 0)
  const daily = r.daily.map((d) => {
    const m = r.category_daily.find((x) => x.date === d.date && x.category === MEMBERSHIP)
    return { date: d.date, units: num(m?.units), revenue: num(m?.revenue) }
  })
  if (!plans.length)
    return (
      <div className="mt-6 rounded-xl bg-paper p-8 ring-1 ring-ink/5">
        <h2 className="font-display text-3xl font-extrabold uppercase leading-none">No memberships sold in this range</h2>
        <p className="mt-3 max-w-prose text-smoke">
          Memberships show up here when they're sold through the register. In Inventory, add each plan (Day Pass, Monthly and so on) as a product with category <b className="text-ink">Membership</b> and type <b className="text-ink">Service, no stock</b>, at your real prices.
        </p>
      </div>
    )
  const top = [...plans].sort((a, b) => num(b.units) - num(a.units))[0]
  return (
    <>
      <Kpis
        items={[
          { label: 'Memberships sold', value: sold, note: `${(sold / r.daily.length).toFixed(1)} per day on average` },
          { label: 'Membership sales', value: revenue, fmt: money, note: `${pct(revenue, allLines)} of all sales` },
          { label: 'Average price', value: sold ? revenue / sold : 0, fmt: money, note: 'Per membership sold' },
          { label: 'Most popular', value: top.name, note: `${top.units} sold · ${money(top.revenue)}` },
        ]}
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Memberships sold" note="Count per period" className="xl:col-span-3" i={0}>
          <OneSeries rows={daily} name="Sold" field="units" fmt={(v) => num(v).toLocaleString('en-PH')} />
        </Panel>
        <Panel title="By plan" note="Number sold" className="xl:col-span-2" i={1}>
          <HBars rows={[...plans].sort((a, b) => num(b.units) - num(a.units)).map((x) => ({ name: x.name, value: num(x.units) }))} fmt={(v) => num(v).toLocaleString('en-PH')} />
        </Panel>
        <Panel title="Plans" className="xl:col-span-5" i={2}>
          <RankTable
            rows={[...plans].sort((a, b) => num(b.revenue) - num(a.revenue)).map((x) => ({ ...x, id: x.product_id }))}
            barKey="revenue"
            cols={[
              { key: 'name', label: 'Plan', fmt: (v) => <b className="font-semibold">{v}</b> },
              { key: 'units', label: 'Sold', num: true },
              { key: 'revenue', label: 'Sales', num: true, fmt: money },
              { key: 'share', label: 'Share of memberships', num: true, last: true, fmt: (_, x) => pct(num(x.units), sold) },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}

function Staff({ r }) {
  const staff = r.staff.map((s) => ({ ...s, id: s.staff_id, avg: s.receipts ? num(s.revenue) / s.receipts : 0 }))
  const top = staff[0]
  return (
    <>
      <Kpis
        items={[
          { label: 'Staff on the register', value: staff.length, note: 'Made at least one sale' },
          { label: 'Top seller', value: top ? top.name : '–', note: top ? `${money(top.revenue)} · ${top.receipts} receipts` : 'No sales yet' },
          { label: 'Most memberships', value: staff.length ? [...staff].sort((a, b) => num(b.memberships) - num(a.memberships))[0].name : '–', note: staff.length ? `${[...staff].sort((a, b) => num(b.memberships) - num(a.memberships))[0].memberships} sold` : '' },
          { label: 'Discounts given', value: num(r.totals.discounts), fmt: money, note: 'Across all staff' },
        ]}
      />
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Sales by staff" className="xl:col-span-2" i={0}>
          <HBars rows={staff.map((s) => ({ name: s.name, value: num(s.revenue) }))} />
        </Panel>
        <Panel title="Leaderboard" note="Discounts are worth a look: they come straight off the till" className="xl:col-span-3" i={1}>
          <RankTable
            rows={staff}
            barKey="revenue"
            cols={[
              { key: 'name', label: 'Staff', fmt: (v, s) => (<span><b className="font-semibold">{v}</b> {s.role === 'admin' && <span className="text-xs font-bold uppercase tracking-[0.08em] text-smoke">Admin</span>}</span>) },
              { key: 'receipts', label: 'Receipts', num: true },
              { key: 'revenue', label: 'Sales', num: true, fmt: money },
              { key: 'avg', label: 'Avg sale', num: true, fmt: money },
              { key: 'memberships', label: 'Memberships', num: true },
              { key: 'discounts', label: 'Discounts', num: true, last: true, fmt: money },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}
