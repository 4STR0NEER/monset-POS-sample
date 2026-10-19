import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { History, Pencil, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { money } from '../../lib/util.js'
import { Segmented, Sheet, fmtDateTime } from '../../components/ui.jsx'
import { MoneyField, Notice, Problem, StatusPill, Submit, field, label } from '../../components/form.jsx'
import { BASIS, FREQ } from './Payroll.jsx'

const BLANK = { full_name: '', position: '', profile_id: '', pay_frequency: 'semi_monthly', pay_basis: 'monthly', rate: '', contributions_enabled: true, minimum_wage_earner: false, sss_no: '', philhealth_no: '', pagibig_no: '', tin: '', start_date: '', is_active: true, notes: '' }

export default function Employees() {
  const [emps, setEmps] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null) // 'new' or employee id
  const [showOld, setShowOld] = useState(false)

  const load = useCallback(async () => {
    const [e, p] = await Promise.all([supabase.from('employees').select('*').order('full_name'), supabase.from('profiles').select('id, full_name, role').order('full_name')])
    if (e.error) return setError(e.error.message)
    setError(null)
    setEmps(e.data)
    setPeople(p.data ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const shown = (emps ?? []).filter((e) => showOld || e.is_active)
  const editing = emps?.find((e) => e.id === open)
  const missingIds = (e) => e.contributions_enabled && [e.sss_no, e.philhealth_no, e.pagibig_no, e.tin].filter((x) => !x).length

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-smoke">
          <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} className="size-4 accent-[#19171B]" /> Show people who left
        </label>
        <button type="button" onClick={() => setOpen('new')} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> Add employee
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Problem>Couldn't load employees. {error}</Problem>
        </div>
      )}
      <div className="mt-4 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {!emps && !error && <div className="skeleton h-40" role="status" aria-label="Loading employees" />}
        {emps && shown.length === 0 && <p className="px-5 py-14 text-center text-smoke">No employees yet. Add everyone on payroll: coaches, front desk, cleaners.</p>}
        {shown.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Name</th>
                <th scope="col" className="px-3 py-3 font-bold">Paid</th>
                <th scope="col" className="px-3 py-3 font-bold">Deductions</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {shown.map((e) => (
                <tr key={e.id} onClick={() => setOpen(e.id)} className={`group cursor-pointer transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3 ${e.is_active ? '' : 'text-smoke'}`}>
                  <td className="px-5 py-3 max-md:p-0">
                    <button type="button" onClick={(ev) => (ev.stopPropagation(), setOpen(e.id))} className="text-left">
                      <span className="font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{e.full_name}</span>
                      <span className="block text-xs text-smoke">
                        {e.position || 'No position set'}
                        {!e.is_active && ' · left'}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3 max-md:col-span-2 max-md:order-3 max-md:p-0 max-md:pt-1 max-md:text-xs max-md:text-smoke">{FREQ[e.pay_frequency]}</td>
                  <td className="px-3 py-3 max-md:hidden">
                    {e.contributions_enabled ? 'SSS, PhilHealth, Pag-IBIG' : 'No contributions'}
                    {e.minimum_wage_earner ? ' · tax-exempt (MWE)' : ' · tax'}
                    {missingIds(e) > 0 && (
                      <span className="mt-1 block">
                        <StatusPill tone="bg-gold/25 text-[#6B4E00]">{missingIds(e)} ID number{missingIds(e) === 1 ? '' : 's'} missing</StatusPill>
                      </span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right font-semibold max-md:p-0">
                    {money(e.rate)}
                    <span className="font-normal text-smoke">/{BASIS[e.pay_basis]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <AnimatePresence>{open && (open === 'new' || editing) && <EmployeeSheet key="emp" emp={editing} people={people} onClose={() => setOpen(null)} onDone={load} />}</AnimatePresence>
    </>
  )
}

function EmployeeSheet({ emp, people, onClose, onDone }) {
  const create = !emp
  const [tab, setTab] = useState('details')
  const [f, setF] = useState(() => (create ? BLANK : Object.fromEntries(Object.entries({ ...BLANK, ...emp }).map(([k, v]) => [k, v == null ? '' : k === 'rate' ? String(Number(v)) : v]))))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    setNotice(null)
    if (!f.full_name.trim()) return setErr('Enter their name.')
    if (f.rate === '' || Number(f.rate) < 0) return setErr('Enter their rate.')
    const row = {
      full_name: f.full_name.trim(),
      position: f.position.trim() || null,
      profile_id: f.profile_id || null,
      pay_frequency: f.pay_frequency,
      pay_basis: f.pay_basis,
      rate: Number(f.rate),
      contributions_enabled: f.contributions_enabled,
      minimum_wage_earner: f.minimum_wage_earner,
      sss_no: f.sss_no.trim() || null,
      philhealth_no: f.philhealth_no.trim() || null,
      pagibig_no: f.pagibig_no.trim() || null,
      tin: f.tin.trim() || null,
      start_date: f.start_date || null,
      is_active: f.is_active,
      notes: f.notes.trim() || null,
    }
    setBusy(true)
    const res = create ? await supabase.from('employees').insert(row) : await supabase.from('employees').update(row).eq('id', emp.id)
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    onDone()
    if (create) onClose()
    else setNotice('Saved. Rate changes apply to pay runs you create or recalculate from now on.')
  }

  const rateLabel = { monthly: 'Monthly salary', daily: 'Daily rate', hourly: 'Hourly rate' }[f.pay_basis]

  return (
    <Sheet
      title={create ? 'Add employee' : emp.full_name}
      subtitle={create ? 'Anyone on payroll. They don’t need a POS login.' : `${FREQ[emp.pay_frequency]} · ${money(emp.rate)}/${BASIS[emp.pay_basis]}`}
      onClose={onClose}
      header={!create && <Segmented id="emp-tab" dark className="mt-4" value={tab} onChange={setTab} options={[['details', 'Details', Pencil], ['history', 'History', History]]} />}
    >
      {tab === 'history' && emp ? (
        <EmployeeHistory emp={emp} people={people} />
      ) : (
        <form onSubmit={save} className="space-y-4">
          <AnimatePresence>{notice && <Notice>{notice}</Notice>}</AnimatePresence>
          <div className="grid grid-cols-2 gap-3">
            <label className={`${label} col-span-2 sm:col-span-1`}>
              Full name
              <input autoFocus={create} value={f.full_name} onChange={(e) => set('full_name')(e.target.value)} className={`${field} mt-1.5`} />
            </label>
            <label className={`${label} col-span-2 sm:col-span-1`}>
              Position
              <input value={f.position} onChange={(e) => set('position')(e.target.value)} placeholder="Coach, front desk…" className={`${field} mt-1.5`} />
            </label>
          </div>
          <div>
            <p className={label}>How often they're paid</p>
            <Segmented id="emp-freq" className="mt-1.5" value={f.pay_frequency} onChange={set('pay_frequency')} options={Object.entries(FREQ)} />
          </div>
          <div>
            <p className={label}>Paid by the</p>
            <Segmented id="emp-basis" className="mt-1.5" value={f.pay_basis} onChange={set('pay_basis')} options={[['monthly', 'Month'], ['daily', 'Day'], ['hourly', 'Hour']]} />
          </div>
          <label className={label}>
            {rateLabel}
            <MoneyField value={f.rate} onChange={set('rate')} className="mt-1.5" />
            <span className="mt-1 block font-normal text-smoke">
              {f.pay_basis === 'monthly'
                ? f.pay_frequency === 'semi_monthly'
                  ? 'Each payout suggests half of this.'
                  : f.pay_frequency === 'weekly'
                    ? 'Each payout suggests 12/52 of this.'
                    : 'Each payout suggests the full amount.'
                : `Each payout multiplies this by the ${f.pay_basis === 'daily' ? 'days' : 'hours'} worked.`}{' '}
              You can change any payslip before finalizing.
            </span>
          </label>
          <div className="space-y-2 rounded-xl bg-paper p-4 ring-1 ring-ink/5">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block font-semibold">Deduct SSS, PhilHealth and Pag-IBIG</span>
                <span className="text-sm text-smoke">Turn off only for people who aren't employees, like freelance coaches.</span>
              </span>
              <input type="checkbox" checked={f.contributions_enabled} onChange={(e) => set('contributions_enabled')(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#19171B]" />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-ink/8 pt-2">
              <span>
                <span className="block font-semibold">Minimum wage earner</span>
                <span className="text-sm text-smoke">No withholding tax.</span>
              </span>
              <input type="checkbox" checked={f.minimum_wage_earner} onChange={(e) => set('minimum_wage_earner')(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#19171B]" />
            </label>
          </div>
          <fieldset>
            <legend className={label}>Government numbers</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              {[
                ['sss_no', 'SSS'],
                ['philhealth_no', 'PhilHealth'],
                ['pagibig_no', 'Pag-IBIG'],
                ['tin', 'TIN'],
              ].map(([k, l]) => (
                <label key={k} className="block text-sm text-smoke">
                  {l}
                  <input value={f[k]} onChange={(e) => set(k)(e.target.value)} className={`${field} tabular mt-1 text-ink`} />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Start date
              <input type="date" value={f.start_date} onChange={(e) => set('start_date')(e.target.value)} className={`${field} tabular mt-1.5`} />
            </label>
            <label className={label}>
              POS login <span className="font-normal text-smoke">(optional)</span>
              <select value={f.profile_id} onChange={(e) => set('profile_id')(e.target.value)} className={`${field} mt-1.5`}>
                <option value="">None</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={label}>
            Notes <span className="font-normal text-smoke">(optional)</span>
            <textarea value={f.notes} onChange={(e) => set('notes')(e.target.value)} rows={2} className={`${field} mt-1.5 h-auto py-2.5`} />
          </label>
          {!create && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-paper p-4 ring-1 ring-ink/5">
              <span>
                <span className="block font-semibold">Still working here</span>
                <span className="text-sm text-smoke">Turn off when someone leaves. Their past payslips stay.</span>
              </span>
              <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active')(e.target.checked)} className="size-5 shrink-0 accent-[#19171B]" />
            </label>
          )}
          {err && <Problem>{err}</Problem>}
          <Submit busy={busy}>{create ? 'Add employee' : 'Save changes'}</Submit>
        </form>
      )}
    </Sheet>
  )
}

const LABELS = { full_name: 'Name', position: 'Position', profile_id: 'POS login', pay_frequency: 'Paid', pay_basis: 'Paid by', rate: 'Rate', contributions_enabled: 'Contributions', minimum_wage_earner: 'Minimum wage earner', sss_no: 'SSS no.', philhealth_no: 'PhilHealth no.', pagibig_no: 'Pag-IBIG no.', tin: 'TIN', start_date: 'Start date', is_active: 'Still working here' }

function EmployeeHistory({ emp, people }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    supabase
      .from('employee_changes')
      .select('*')
      .eq('employee_id', emp.id)
      .order('changed_at', { ascending: false })
      .then(({ data, error }) => (error ? setErr(error.message) : setItems(data)))
  }, [emp.id, emp.updated_at])
  const name = Object.fromEntries(people.map((p) => [p.id, p.full_name]))
  const val = (f, v) => (v == null || v === '' ? '–' : f === 'rate' ? money(v) : f === 'pay_frequency' ? FREQ[v] : f === 'profile_id' ? (name[v] ?? 'a login') : v === 'true' ? 'yes' : v === 'false' ? 'no' : v)
  if (err) return <Problem>{err}</Problem>
  if (!items) return <div className="skeleton h-24 rounded-lg bg-paper" />
  return (
    <ol className="space-y-1">
      {items.map((c) => (
        <li key={c.id} className="rounded-lg px-2 py-2.5 text-sm">
          <p className="font-semibold">{c.field === 'created' ? 'Added to payroll' : `${LABELS[c.field] ?? c.field}: ${val(c.field, c.old_value)} → ${val(c.field, c.new_value)}`}</p>
          <p className="text-xs text-smoke">
            {fmtDateTime(c.changed_at)} · {name[c.changed_by] ?? 'Someone'}
          </p>
        </li>
      ))}
    </ol>
  )
}
