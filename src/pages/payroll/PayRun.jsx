import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { ArrowLeft, Ban, CircleAlert, Download, Loader2, Plus, Save, Stamp, Trash2, X } from 'lucide-react'
import { useAuth } from '../../auth.jsx'
import { downloadPayslips } from '../../lib/reports.js'
import { supabase } from '../../lib/supabase.js'
import { money } from '../../lib/util.js'
import { EMPTY_PRIOR, addToPrior, computePayslip, ratesOn, suggestedBasic } from '../../lib/payroll.js'
import { fmtDateTime } from '../../components/ui.jsx'
import { Notice, Problem, StatusPill, Submit, field } from '../../components/form.jsx'
import { addDays } from '../../components/RangePicker.jsx'
import { BASIS, FREQ, RUN_STATUS, employerCost, fmtDay, periodLabel } from './Payroll.jsx'

const INPUTS = ['days_worked', 'hours_worked', 'basic_pay', 'overtime_pay', 'allowances_taxable', 'allowances_nontaxable', 'other_deductions']
const cell = 'tabular h-9 w-24 rounded-md bg-paper px-2 text-right ring-1 ring-ink/15 outline-none focus:ring-2 focus:ring-gold'
const toInput = (v) => (v == null ? '' : String(Number(v)))
const monthBounds = (d) => [d.slice(0, 8) + '01', addDays(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1)).toISOString().slice(0, 10), -1)]

export default function PayRun() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState(null)
  const [items, setItems] = useState([])
  const [emps, setEmps] = useState([])
  const [rateRows, setRateRows] = useState([])
  const [priors, setPriors] = useState({})
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [confirm, setConfirm] = useState(null) // 'finalize' | 'delete'
  const [voidReason, setVoidReason] = useState('')
  const { profile } = useAuth()

  const load = useCallback(async () => {
    const [r, it, e, rr, pp] = await Promise.all([
      supabase.from('payroll_runs').select('*').eq('id', id).maybeSingle(),
      supabase.from('payroll_items').select('*').eq('run_id', id).order('employee_name'),
      supabase.from('employees').select('*').order('full_name'),
      supabase.from('payroll_rates').select('*'),
      supabase.from('profiles').select('id, full_name'),
    ])
    const err = [r, it, e, rr].find((x) => x.error)?.error
    if (err) return setError(err.message)
    if (!r.data) return setError('Pay run not found.')
    setError(null)
    setRun(r.data)
    setItems(it.data.map((x) => ({ ...x, ...Object.fromEntries(INPUTS.map((k) => [k, toInput(x[k])])), deductions_note: x.deductions_note ?? '' })))
    setEmps(e.data)
    setRateRows(rr.data)
    setPeople(Object.fromEntries((pp.data ?? []).map((p) => [p.id, p.full_name])))
    setDirty(false)
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  // Earlier finalized payslips in the same month (by pay date): contributions and tax are settled month-to-date.
  const loadPriors = useCallback(async (payDate) => {
    const [ms] = monthBounds(payDate)
    const { data, error } = await supabase
      .from('payroll_items')
      .select('*, payroll_runs!inner(pay_date, status, finalized_at)')
      .eq('payroll_runs.status', 'finalized')
      .gte('payroll_runs.pay_date', ms)
      .lte('payroll_runs.pay_date', payDate)
      .neq('run_id', id)
    if (error) {
      setError(error.message)
      return null
    }
    const out = {}
    for (const it of data.sort((a, b) => (a.payroll_runs.pay_date < b.payroll_runs.pay_date ? -1 : 1))) out[it.employee_id] = addToPrior(out[it.employee_id] ?? EMPTY_PRIOR, it)
    setPriors(out)
    return out
  }, [id])
  useEffect(() => {
    if (run?.status === 'draft') loadPriors(run.pay_date)
  }, [run?.status, run?.pay_date, loadPriors])

  const draft = run?.status === 'draft'
  const byId = Object.fromEntries(emps.map((e) => [e.id, e]))
  const rates = useMemo(() => (run ? ratesOn(rateRows, run.pay_date) : {}), [rateRows, run])
  const missingRates = ['sss', 'philhealth', 'pagibig', 'tax'].filter((k) => !rates[k])
  // Drafts are computed live; finalized and voided runs show exactly what was stored.
  const computeAll = (p) => items.map((it) => (draft && !missingRates.length ? { ...it, ...computePayslip(it, byId[it.employee_id] ?? { contributions_enabled: true }, rates, p[it.employee_id]) } : it))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slips = useMemo(() => computeAll(priors), [items, draft, rates, priors, emps])
  const total = (k) => slips.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const eeDeductions = total('sss_ee') + total('philhealth_ee') + total('pagibig_ee') + total('withholding_tax') + total('other_deductions')
  const erContrib = total('sss_er') + total('sss_ec') + total('philhealth_er') + total('pagibig_er')

  const edit = (i, k, v) => {
    setDirty(true)
    setMsg(null)
    setItems((xs) =>
      xs.map((x, j) => {
        if (j !== i) return x
        const next = { ...x, [k]: v }
        // Changing days or hours re-suggests basic pay; basic can still be overwritten after.
        if (k === 'days_worked' || k === 'hours_worked') next.basic_pay = String(suggestedBasic(byId[x.employee_id] ?? x, { days: next.days_worked, hours: next.hours_worked }))
        return next
      }),
    )
  }
  const setRunField = (k, v) => {
    setDirty(true)
    setRun((r) => ({ ...r, [k]: v }))
  }

  const save = async (p = priors) => {
    setBusy('save')
    setError(null)
    const runUpd = await supabase.from('payroll_runs').update({ period_start: run.period_start, period_end: run.period_end, pay_date: run.pay_date, notes: run.notes }).eq('id', id)
    const rows = computeAll(p).map((s) => {
      const out = { id: s.id, run_id: id, employee_id: s.employee_id, employee_name: s.employee_name, pay_basis: s.pay_basis, rate: s.rate, deductions_note: s.deductions_note?.trim() || null }
      out.days_worked = s.days_worked === '' ? null : Number(s.days_worked)
      out.hours_worked = s.hours_worked === '' ? null : Number(s.hours_worked)
      for (const k of ['basic_pay', 'overtime_pay', 'allowances_taxable', 'allowances_nontaxable', 'other_deductions', 'gross_pay', 'sss_ee', 'sss_er', 'sss_ec', 'philhealth_ee', 'philhealth_er', 'pagibig_ee', 'pagibig_er', 'taxable_income', 'withholding_tax', 'net_pay'])
        out[k] = Number(s[k]) || 0
      return out
    })
    const up = rows.length ? await supabase.from('payroll_items').upsert(rows) : {}
    setBusy(null)
    const err = runUpd.error ?? up.error
    if (err) {
      setError(err.message)
      return false
    }
    setDirty(false)
    return true
  }

  const finalize = async () => {
    if (missingRates.length) return setError('Rates are missing for this pay date. Add them in the Rates tab.')
    if (slips.some((s) => Number(s.net_pay) < 0)) return setError('A payslip has negative net pay. Lower its deductions first.')
    const fresh = await loadPriors(run.pay_date) // latest month-to-date figures before locking
    if (!fresh || !(await save(fresh))) return
    setBusy('finalize')
    const snapshot = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v]))
    const { error } = await supabase.rpc('finalize_payroll', { p_run_id: id, p_rates: snapshot })
    setBusy(null)
    setConfirm(null)
    if (error) return setError(error.message)
    await load()
    setMsg('Finalized. Salaries and employer contributions are now in Expenses.')
  }

  const addEmployee = async (empId) => {
    const emp = byId[empId]
    if (!emp) return
    if (dirty && !(await save())) return
    const { error } = await supabase.from('payroll_items').insert({ run_id: id, employee_id: emp.id, employee_name: emp.full_name, pay_basis: emp.pay_basis, rate: emp.rate, basic_pay: suggestedBasic(emp), gross_pay: 0, net_pay: 0 })
    if (error) return setError(error.message)
    load()
  }
  const removeItem = async (it) => {
    const { error } = await supabase.from('payroll_items').delete().eq('id', it.id)
    if (error) return setError(error.message)
    setItems((xs) => xs.filter((x) => x.id !== it.id))
  }
  const deleteDraft = async () => {
    setBusy('delete')
    const { error } = await supabase.from('payroll_runs').delete().eq('id', id)
    setBusy(null)
    if (error) return setError(error.message)
    navigate('/payroll')
  }
  const voidRun = async (e) => {
    e.preventDefault()
    if (!voidReason.trim()) return setError('Give a reason for voiding.')
    setBusy('void')
    const { error } = await supabase.rpc('void_payroll_run', { p_run_id: id, p_reason: voidReason.trim() })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
    setMsg('Voided. Its expenses were voided too.')
  }

  if (!run)
    return error ? (
      <div className="mt-6">
        <Problem>{error}</Problem>
      </div>
    ) : (
      <Loader2 className="mx-auto mt-16 size-8 animate-spin text-smoke" aria-label="Loading pay run" />
    )

  const [st, StIcon, stTone] = RUN_STATUS[run.status]
  const notIn = emps.filter((e) => e.is_active && !items.some((it) => it.employee_id === e.id))

  return (
    <div className="mt-6">
      <Link to="/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-smoke hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> All pay runs
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-4xl font-black uppercase leading-none">{periodLabel(run)}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-smoke">
            <StatusPill tone={stTone} Icon={StIcon}>
              {st}
            </StatusPill>
            {FREQ[run.pay_frequency]} · pay date {fmtDay(run.pay_date, { month: 'long', day: 'numeric', year: 'numeric' })}
            {run.finalized_at && ` · finalized ${fmtDateTime(run.finalized_at)} by ${people[run.finalized_by] ?? 'an admin'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                setBusy('pdf')
                try {
                  await downloadPayslips({ run, items: slips, employees: emps, by: profile?.full_name })
                } catch (e) {
                  setError(e.message ?? String(e))
                }
                setBusy(null)
              }}
              disabled={busy !== null}
              className="press flex h-11 items-center gap-2 rounded-lg px-4 font-semibold ring-1 ring-ink/15 disabled:opacity-40"
            >
              {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />} {draft ? 'Preview payslips' : 'Payslips PDF'}
            </button>
          )}
        {draft && (
          <>
            <button type="button" onClick={() => save()} disabled={!dirty || busy} className="press flex h-11 items-center gap-2 rounded-lg px-4 font-semibold ring-1 ring-ink/15 disabled:opacity-40">
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />} {dirty ? 'Save draft' : 'Saved'}
            </button>
            <button type="button" onClick={() => setConfirm('finalize')} disabled={!items.length || missingRates.length > 0} className="press flex h-11 items-center gap-2 rounded-lg bg-ink px-4 font-semibold text-paper disabled:opacity-40">
              <Stamp className="size-4" aria-hidden="true" /> Finalize
            </button>
          </>
        )}
        </div>
      </div>

      {run.status === 'voided' && (
        <div className="mt-4">
          <Problem>
            Voided {fmtDateTime(run.voided_at)} by {people[run.voided_by] ?? 'an admin'}: “{run.void_reason}”. It no longer counts in expenses or net profit.
          </Problem>
        </div>
      )}
      {missingRates.length > 0 && draft && (
        <div className="mt-4">
          <Problem>
            No {missingRates.join(', ')} rates in effect on {fmtDay(run.pay_date)}. Add them in the Rates tab first.
          </Problem>
        </div>
      )}
      <div className="mt-4 space-y-3">
        <AnimatePresence>{msg && <Notice>{msg}</Notice>}</AnimatePresence>
        {error && <Problem>{error}</Problem>}
      </div>

      {draft && (
        <div className="mt-4 grid gap-3 rounded-xl bg-paper p-4 ring-1 ring-ink/5 sm:grid-cols-3">
          {[
            ['period_start', 'Period from'],
            ['period_end', 'Period to'],
            ['pay_date', 'Pay date'],
          ].map(([k, l]) => (
            <label key={k} className="block text-sm font-semibold">
              {l}
              <input type="date" value={run[k]} onChange={(e) => e.target.value && setRunField(k, e.target.value)} className={`${field} tabular mt-1.5`} />
            </label>
          ))}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 lg:grid-cols-5">
        {[
          ['Gross pay', total('gross_pay'), `${slips.length} payslip${slips.length === 1 ? '' : 's'}`],
          ['Deducted from staff', eeDeductions, 'Contributions, tax, other'],
          ['Net pay to hand out', total('net_pay'), 'Cash or transfer to staff'],
          ['Employer contributions', erContrib, 'SSS, EC, PhilHealth, Pag-IBIG'],
          ['Cost to the gym', total('gross_pay') + erContrib, 'Goes into Expenses'],
        ].map(([k, v, note], i) => (
          <div key={k} className={`border-ink/8 p-4 max-lg:[&:nth-child(-n+4)]:border-b ${i % 2 === 0 ? 'border-r' : ''} lg:border-r lg:last:border-r-0 ${i === 4 ? 'max-lg:col-span-2' : ''}`}>
            <dt className="text-sm font-semibold text-smoke">{k}</dt>
            <dd className="tabular mt-1.5 font-display text-2xl font-black leading-none sm:text-3xl">{money(v)}</dd>
            <dd className="mt-1 text-xs text-smoke">{note}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-xs text-smoke xl:hidden">Swipe or scroll the table sideways to see every column.</p>
      <div className="mt-2 overflow-x-auto rounded-xl bg-paper ring-1 ring-ink/5 xl:mt-4">
        <table className="w-full min-w-[72rem] text-left text-sm">
          <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.06em] text-smoke">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-paper px-4 py-3 font-bold">Employee</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Days / hrs</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Basic</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Overtime</th>
              <th scope="col" className="px-2 py-3 text-right font-bold" title="Taxable allowances">Allow. (tax)</th>
              <th scope="col" className="px-2 py-3 text-right font-bold" title="Non-taxable allowances">Allow. (non-tax)</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Gross</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">SSS</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">PhilHealth</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Pag-IBIG</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Tax</th>
              <th scope="col" className="px-2 py-3 text-right font-bold">Other ded.</th>
              <th scope="col" className="px-4 py-3 text-right font-bold">Net pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {slips.map((s, i) => {
              const emp = byId[s.employee_id]
              const unit = s.pay_basis === 'daily' ? 'days_worked' : s.pay_basis === 'hourly' ? 'hours_worked' : null
              const inp = (k, w) =>
                draft ? (
                  <input inputMode="decimal" aria-label={`${k.replace(/_/g, ' ')} for ${s.employee_name}`} value={items[i][k]} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && edit(i, k, e.target.value)} className={`${cell} ${w ?? ''}`} />
                ) : (
                  money(s[k])
                )
              return (
                <tr key={s.id} className="align-top">
                  <td className="sticky left-0 z-10 bg-paper px-4 py-2.5">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0">
                        <span className="block font-semibold">{s.employee_name}</span>
                        <span className="tabular block text-xs text-smoke">
                          {money(s.rate)}/{BASIS[s.pay_basis]}
                          {emp?.minimum_wage_earner ? ' · MWE' : ''}
                          {emp && !emp.contributions_enabled ? ' · no contributions' : ''}
                        </span>
                        {draft ? (
                          <input value={items[i].deductions_note} onChange={(e) => edit(i, 'deductions_note', e.target.value)} placeholder="Note (e.g. cash advance)" aria-label={`Note for ${s.employee_name}`} className="mt-1 h-7 w-44 rounded-md bg-mist px-2 text-xs outline-none focus:ring-2 focus:ring-gold" />
                        ) : (
                          s.deductions_note && <span className="block text-xs text-smoke">{s.deductions_note}</span>
                        )}
                      </span>
                      {draft && (
                        <button type="button" onClick={() => removeItem(s)} aria-label={`Remove ${s.employee_name} from this run`} className="press ml-auto grid size-7 shrink-0 place-items-center rounded-md text-smoke hover:bg-crimson/10 hover:text-crimson">
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right">{unit ? (draft ? inp(unit, 'w-16') : `${Number(s[unit] ?? 0)} ${unit === 'days_worked' ? 'd' : 'h'}`) : <span className="text-smoke">–</span>}</td>
                  <td className="px-2 py-2.5 text-right">{inp('basic_pay')}</td>
                  <td className="px-2 py-2.5 text-right">{inp('overtime_pay')}</td>
                  <td className="px-2 py-2.5 text-right">{inp('allowances_taxable')}</td>
                  <td className="px-2 py-2.5 text-right">{inp('allowances_nontaxable')}</td>
                  <td className="tabular px-2 py-2.5 text-right font-semibold">{money(s.gross_pay)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(s.sss_ee)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(s.philhealth_ee)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(s.pagibig_ee)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(s.withholding_tax)}</td>
                  <td className="px-2 py-2.5 text-right">{inp('other_deductions')}</td>
                  <td className={`tabular px-4 py-2.5 text-right font-display text-xl font-black ${Number(s.net_pay) < 0 ? 'text-crimson' : ''}`}>{money(s.net_pay)}</td>
                </tr>
              )
            })}
            {!slips.length && (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-smoke">
                  Nobody in this run yet.
                </td>
              </tr>
            )}
          </tbody>
          {slips.length > 0 && (
            <tfoot className="border-t-2 border-ink/10 font-semibold">
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-paper px-4 py-3 text-left">
                  Totals
                </th>
                <td />
                {['basic_pay', 'overtime_pay', 'allowances_taxable', 'allowances_nontaxable', 'gross_pay', 'sss_ee', 'philhealth_ee', 'pagibig_ee', 'withholding_tax', 'other_deductions'].map((k) => (
                  <td key={k} className="tabular px-2 py-3 text-right">
                    {money(total(k))}
                  </td>
                ))}
                <td className="tabular px-4 py-3 text-right font-display text-xl font-black">{money(total('net_pay'))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {draft && notIn.length > 0 && (
        <label className="mt-3 flex max-w-sm items-center gap-2">
          <Plus className="size-4 shrink-0 text-smoke" aria-hidden="true" />
          <span className="sr-only">Add an employee to this run</span>
          <select value="" onChange={(e) => addEmployee(e.target.value)} className={`${field} font-semibold`}>
            <option value="">Add someone to this run…</option>
            {notIn.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({FREQ[e.pay_frequency].toLowerCase()})
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="mt-2 text-xs text-smoke">
        SSS, PhilHealth, Pag-IBIG and tax are the employee's share, settled month-to-date: whatever was already deducted earlier this month is taken into account.
      </p>

      <Remittance slips={slips} rates={run.rates ?? rates} />

      {confirm === 'finalize' && (
        <div role="alertdialog" aria-labelledby="fin-title" className="mt-6 rounded-xl bg-paper p-5 ring-2 ring-ink">
          <h3 id="fin-title" className="font-display text-2xl font-extrabold uppercase leading-none">
            Finalize this pay run?
          </h3>
          <p className="mt-2 text-sm text-smoke">
            Payslips get locked. {money(total('gross_pay'))} in salaries and {money(erContrib)} in employer contributions go into Expenses on {fmtDay(run.pay_date)}, and into net profit. To undo later you'd void the run with a reason.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={finalize} disabled={busy} className="press flex h-11 items-center gap-2 rounded-lg bg-ink px-4 font-semibold text-paper disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Stamp className="size-4" aria-hidden="true" />} Finalize and post to Expenses
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="press h-11 rounded-lg px-4 font-semibold text-smoke ring-1 ring-ink/15">
              Not yet
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="mt-8 border-t border-ink/10 pt-5">
          {confirm === 'delete' ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold">Delete this draft? Nothing has been posted yet.</p>
              <button type="button" onClick={deleteDraft} disabled={busy} className="press flex h-10 items-center gap-2 rounded-lg bg-crimson px-3 text-sm font-semibold text-paper">
                <Trash2 className="size-4" aria-hidden="true" /> Delete draft
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="press h-10 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/15">
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirm('delete')} className="press flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-crimson ring-1 ring-crimson/30">
              <Trash2 className="size-4" aria-hidden="true" /> Delete draft
            </button>
          )}
        </div>
      )}

      {run.status === 'finalized' && (
        <form onSubmit={voidRun} className="mt-8 max-w-xl space-y-3 rounded-xl p-5 ring-1 ring-crimson/25">
          <h3 className="font-display text-2xl font-extrabold uppercase leading-none">Void this pay run</h3>
          <p className="text-sm text-smoke">For a run made in error. It stays on record, marked voided, and its expenses are voided too. Then start a corrected run.</p>
          <label className="block text-sm font-semibold">
            Reason
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong period, wrong rates…" className={`${field} mt-1.5`} />
          </label>
          <Submit busy={busy === 'void'} tone="bg-crimson text-paper">
            <Ban className="size-5" aria-hidden="true" /> Void pay run
          </Submit>
        </form>
      )}
    </div>
  )
}

// What to remit for this run, employee and employer shares side by side.
function Remittance({ slips, rates }) {
  if (!slips.length) return null
  const t = (k) => slips.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const rows = [
    ['SSS', t('sss_ee'), t('sss_er') + t('sss_ec'), rates?.sss?.effective_from, 'employer share includes EC'],
    ['PhilHealth', t('philhealth_ee'), t('philhealth_er'), rates?.philhealth?.effective_from],
    ['Pag-IBIG', t('pagibig_ee'), t('pagibig_er'), rates?.pagibig?.effective_from],
    ['Withholding tax (BIR)', t('withholding_tax'), 0, rates?.tax?.effective_from],
  ]
  return (
    <section className="mt-6 max-w-3xl rounded-xl bg-paper p-5 ring-1 ring-ink/5" aria-labelledby="remit-title">
      <h3 id="remit-title" className="font-display text-2xl font-extrabold uppercase leading-none">
        To remit for this run
      </h3>
      <table className="tabular mt-3 w-full text-left text-sm">
        <thead className="text-xs font-bold uppercase tracking-[0.06em] text-smoke">
          <tr>
            <th className="py-2 font-bold">Agency</th>
            <th className="py-2 text-right font-bold">From staff</th>
            <th className="py-2 text-right font-bold">From gym</th>
            <th className="py-2 text-right font-bold">Total</th>
            <th className="py-2 pl-4 font-bold max-sm:hidden">Rates from</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {rows.map(([n, ee, er, from, note]) => (
            <tr key={n}>
              <td className="py-2 font-semibold">
                {n}
                {note && <span className="block text-xs font-normal text-smoke">{note}</span>}
              </td>
              <td className="py-2 text-right">{money(ee)}</td>
              <td className="py-2 text-right">{er ? money(er) : '–'}</td>
              <td className="py-2 text-right font-semibold">{money(ee + er)}</td>
              <td className="py-2 pl-4 text-smoke max-sm:hidden">{from ? fmtDay(from, { month: 'short', day: 'numeric', year: 'numeric' }) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex items-start gap-2 text-xs text-smoke">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Remittance deadlines and forms follow each agency's current rules; your accountant files them.
      </p>
    </section>
  )
}
