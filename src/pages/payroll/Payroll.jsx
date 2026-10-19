import { useCallback, useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, CircleAlert, CircleCheck, FilePen, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { manilaToday, money } from '../../lib/util.js'
import { suggestedBasic } from '../../lib/payroll.js'
import { Sheet } from '../../components/ui.jsx'
import { Problem, StatusPill, Submit, field, label } from '../../components/form.jsx'
import { addDays } from '../../components/RangePicker.jsx'
import PayRun from './PayRun.jsx'
import Employees from './Employees.jsx'
import Rates from './Rates.jsx'

export const FREQ = { weekly: 'Weekly', semi_monthly: 'Twice a month', monthly: 'Monthly' }
export const BASIS = { monthly: 'month', daily: 'day', hourly: 'hour' }
export const RUN_STATUS = {
  draft: ['Draft', FilePen, 'bg-gold/25 text-[#6B4E00]'],
  finalized: ['Finalized', CircleCheck, 'bg-active/12 text-[#0B6B35]'],
  voided: ['Voided', Ban, 'bg-crimson/10 text-crimson'],
}
export const fmtDay = (d, o = { month: 'short', day: 'numeric' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })
export const periodLabel = (r) => `${fmtDay(r.period_start)} – ${fmtDay(r.period_end, { month: 'short', day: 'numeric', year: 'numeric' })}`
export const employerCost = (it) => Number(it.gross_pay) + Number(it.sss_er) + Number(it.sss_ec) + Number(it.philhealth_er) + Number(it.pagibig_er)

// The current pay period for a schedule, as Manila dates.
function suggestPeriod(freq, today) {
  const ms = today.slice(0, 8) + '01'
  const me = addDays(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 10), -1)
  if (freq === 'monthly') return [ms, me]
  if (freq === 'semi_monthly') return Number(today.slice(8)) <= 15 ? [ms, today.slice(0, 8) + '15'] : [today.slice(0, 8) + '16', me]
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7 // Monday = 0
  return [addDays(today, -dow), addDays(today, 6 - dow)]
}

const TABS = [
  ['Pay runs', '/payroll'],
  ['Employees', '/payroll/employees'],
  ['Rates', '/payroll/rates'],
]

export default function Payroll() {
  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <h1 className="font-display text-5xl font-black uppercase leading-none">Payroll</h1>
      <p className="mt-1 text-smoke">Pay runs, payslips and government contributions. Finalized pay runs go into Expenses and net profit.</p>
      <nav aria-label="Payroll" className="mt-5 flex gap-1 overflow-x-auto border-b border-ink/10">
        {TABS.map(([l, to]) => (
          <NavLink key={to} to={to} end={to === '/payroll'} className="relative shrink-0 px-4 pt-1 pb-3 text-sm font-semibold">
            {({ isActive }) => (
              <>
                <span className={`transition-colors duration-150 ${isActive ? 'text-ink' : 'text-smoke hover:text-ink'}`}>{l}</span>
                {isActive && <motion.span layoutId="pay-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Runs />} />
        <Route path="runs/:id" element={<PayRun />} />
        <Route path="employees" element={<Employees />} />
        <Route path="rates" element={<Rates />} />
      </Routes>
    </main>
  )
}

function Runs() {
  const [runs, setRuns] = useState(null)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*, payroll_items(gross_pay, net_pay, sss_er, sss_ec, philhealth_er, pagibig_er)')
      .order('pay_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return setError(error.message)
    setError(null)
    setRuns(data)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-smoke">Start a run, fill in each payslip, then finalize. Drafts can be changed or deleted; finalized runs are locked.</p>
        <button type="button" onClick={() => setAdding(true)} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> New pay run
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Problem>Couldn't load pay runs. {error}</Problem>
        </div>
      )}
      <div className="mt-4 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {!runs && !error && (
          <div role="status" aria-label="Loading pay runs" className="divide-y divide-ink/5">
            {Array.from({ length: 4 }, (_, k) => (
              <div key={k} className="skeleton h-16" style={{ animationDelay: `${k * 60}ms` }} />
            ))}
          </div>
        )}
        {runs?.length === 0 && <p className="px-5 py-14 text-center text-smoke">No pay runs yet. Add your employees first, then start a pay run.</p>}
        {runs?.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Pay period</th>
                <th scope="col" className="px-3 py-3 font-bold">Status</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Staff</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Gross</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Net pay</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Cost to gym</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {runs.map((r) => {
                const sum = (f) => r.payroll_items.reduce((s, it) => s + f(it), 0)
                const [st, Icon, tone] = RUN_STATUS[r.status]
                const voided = r.status === 'voided'
                return (
                  <tr key={r.id} onClick={() => navigate(`/payroll/runs/${r.id}`)} className={`group cursor-pointer transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3 ${voided ? 'text-smoke' : ''}`}>
                    <td className="px-5 py-3 max-md:p-0">
                      <button type="button" onClick={(e) => (e.stopPropagation(), navigate(`/payroll/runs/${r.id}`))} className="text-left">
                        <span className="tabular font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{periodLabel(r)}</span>
                        <span className="block text-xs text-smoke">
                          {FREQ[r.pay_frequency]} · paid {fmtDay(r.pay_date)}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3 max-md:p-0 max-md:text-right">
                      <StatusPill tone={tone} Icon={Icon}>
                        {st}
                      </StatusPill>
                    </td>
                    <td className="tabular px-3 py-3 text-right max-md:hidden">{r.payroll_items.length}</td>
                    <td className="tabular px-3 py-3 text-right max-md:hidden">{money(sum((it) => Number(it.gross_pay)))}</td>
                    <td className="tabular px-3 py-3 text-right max-md:col-span-2 max-md:p-0 max-md:pt-1 max-md:text-left">
                      <span className="text-xs text-smoke md:hidden">Net pay </span>
                      {r.status === 'draft' ? <span className="text-smoke">draft</span> : money(sum((it) => Number(it.net_pay)))}
                    </td>
                    <td className={`tabular px-5 py-3 text-right font-display text-xl font-black max-md:hidden ${voided ? 'line-through decoration-2' : ''}`}>{r.status === 'draft' ? <span className="font-sans text-sm font-normal text-smoke">draft</span> : money(sum(employerCost))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <AnimatePresence>{adding && <NewRunSheet key="new" onClose={() => setAdding(false)} onCreated={(id) => navigate(`/payroll/runs/${id}`)} />}</AnimatePresence>
    </>
  )
}

function NewRunSheet({ onClose, onCreated }) {
  const today = manilaToday()
  const [emps, setEmps] = useState(null)
  const [freq, setFreq] = useState('semi_monthly')
  const [period, setPeriod] = useState(() => suggestPeriod('semi_monthly', today))
  const [payDate, setPayDate] = useState(period[1])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) return setErr(error.message)
        setEmps(data)
        const counts = data.reduce((c, e) => ((c[e.pay_frequency] = (c[e.pay_frequency] ?? 0) + 1), c), {})
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
        if (top) {
          setFreq(top)
          const p = suggestPeriod(top, today)
          setPeriod(p)
          setPayDate(p[1])
        }
      })
  }, [today])

  const pick = (f) => {
    setFreq(f)
    const p = suggestPeriod(f, today)
    setPeriod(p)
    setPayDate(p[1])
  }
  const included = (emps ?? []).filter((e) => e.pay_frequency === freq)

  const create = async (e) => {
    e.preventDefault()
    setErr(null)
    if (period[1] < period[0]) return setErr('The period ends before it starts.')
    setBusy(true)
    const { data: run, error } = await supabase.from('payroll_runs').insert({ pay_frequency: freq, period_start: period[0], period_end: period[1], pay_date: payDate }).select('id').single()
    if (error) {
      setBusy(false)
      return setErr(error.message)
    }
    if (included.length) {
      const { error: e2 } = await supabase.from('payroll_items').insert(
        included.map((emp) => ({ run_id: run.id, employee_id: emp.id, employee_name: emp.full_name, pay_basis: emp.pay_basis, rate: emp.rate, basic_pay: suggestedBasic(emp), gross_pay: suggestedBasic(emp), net_pay: 0 })),
      )
      if (e2) {
        setBusy(false)
        return setErr(e2.message)
      }
    }
    onCreated(run.id)
  }

  return (
    <Sheet title="New pay run" subtitle="Starts as a draft you can change freely." onClose={onClose}>
      <form onSubmit={create} className="space-y-4">
        <label className={label}>
          Who's being paid
          <select value={freq} onChange={(e) => pick(e.target.value)} className={`${field} mt-1.5`}>
            {Object.entries(FREQ).map(([v, l]) => (
              <option key={v} value={v}>
                {l} staff ({(emps ?? []).filter((x) => x.pay_frequency === v).length})
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Period from
            <input type="date" value={period[0]} onChange={(e) => e.target.value && setPeriod([e.target.value, period[1]])} className={`${field} tabular mt-1.5`} />
          </label>
          <label className={label}>
            to
            <input type="date" value={period[1]} onChange={(e) => e.target.value && setPeriod([period[0], e.target.value])} className={`${field} tabular mt-1.5`} />
          </label>
        </div>
        <label className={label}>
          Pay date
          <input type="date" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} className={`${field} tabular mt-1.5`} />
          <span className="mt-1 block font-normal text-smoke">Contributions and tax are counted in the month of the pay date.</span>
        </label>
        <div className="rounded-xl bg-paper p-4 text-sm ring-1 ring-ink/5">
          {emps === null ? (
            'Loading employees…'
          ) : included.length ? (
            <>
              <p className="font-semibold">{included.length} employee{included.length === 1 ? '' : 's'} will be added:</p>
              <p className="mt-1 text-smoke">{included.map((e) => e.full_name).join(', ')}</p>
              <p className="mt-2 text-smoke">You can add or remove people in the run.</p>
            </>
          ) : (
            <p className="flex items-start gap-2 text-smoke">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Nobody is paid {FREQ[freq].toLowerCase()} yet. Add employees in the Employees tab, or add people to the run after creating it.
            </p>
          )}
        </div>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>Create draft</Submit>
      </form>
    </Sheet>
  )
}
