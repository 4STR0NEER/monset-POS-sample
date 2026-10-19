import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { CircleAlert, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { manilaToday, money } from '../../lib/util.js'
import { ratesOn } from '../../lib/payroll.js'
import { Sheet } from '../../components/ui.jsx'
import { Problem, Submit, field, label } from '../../components/form.jsx'
import { fmtDay } from './Payroll.jsx'

// Each field: [key, label, 'pct' | 'money' | 'number']. Percentages are stored as decimals (5% = 0.05).
const KINDS = {
  sss: {
    name: 'SSS',
    about: 'On monthly salary credit (pay rounded to the nearest step, between the minimum and maximum). EC is paid by the employer only.',
    fields: [
      ['ee_rate', 'Employee share', 'pct'],
      ['er_rate', 'Employer share', 'pct'],
      ['msc_min', 'Lowest salary credit', 'money'],
      ['msc_max', 'Highest salary credit', 'money'],
      ['msc_step', 'Salary credit steps of', 'money'],
      ['ec_threshold', 'EC higher amount from salary credit', 'money'],
      ['ec_low', 'EC below that', 'money'],
      ['ec_high', 'EC at or above', 'money'],
    ],
  },
  philhealth: {
    name: 'PhilHealth',
    about: 'Premium on monthly basic salary, kept between the floor and ceiling, shared by employee and employer.',
    fields: [
      ['rate', 'Premium rate', 'pct'],
      ['ee_share', 'Employee pays this part of it', 'pct'],
      ['floor', 'Salary floor', 'money'],
      ['ceiling', 'Salary ceiling', 'money'],
    ],
  },
  pagibig: {
    name: 'Pag-IBIG',
    about: 'On monthly pay up to the maximum fund salary.',
    fields: [
      ['ee_rate', 'Employee share', 'pct'],
      ['ee_rate_low', 'Employee share for low pay', 'pct'],
      ['low_threshold', 'Low pay is at or below', 'money'],
      ['er_rate', 'Employer share', 'pct'],
      ['max_fund_salary', 'Maximum fund salary', 'money'],
    ],
  },
  tax: {
    name: 'Withholding tax',
    about: 'BIR monthly table. Tax = fixed amount + rate × (taxable pay above the bracket start). Taxable pay is after the employee’s contributions.',
    fields: [],
  },
}
const show = (t, v) => (v == null ? '–' : t === 'pct' ? `${+(v * 100).toFixed(4)}%` : t === 'money' ? money(v) : v)

export default function Rates() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(null) // kind
  const today = manilaToday()

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('payroll_rates').select('*').order('effective_from', { ascending: false })
    if (error) return setError(error.message)
    setError(null)
    setRows(data)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const current = rows ? ratesOn(rows, today) : {}

  return (
    <>
      <p role="note" className="mt-6 flex items-start gap-2 rounded-xl bg-gold/20 p-4 text-sm text-[#5A4300]">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          These start with the rates published for 2025. <b>Have your accountant confirm them before the first real payroll.</b> When the government changes a rate, add a new version with the date it starts. Older payslips keep the rates they were made with.
        </span>
      </p>
      {error && (
        <div className="mt-4">
          <Problem>Couldn't load rates. {error}</Problem>
        </div>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {Object.entries(KINDS).map(([kind, k]) => {
          const cur = current[kind]
          const older = (rows ?? []).filter((r) => r.kind === kind && r.id !== cur?.id)
          return (
            <section key={kind} className="rounded-xl bg-paper p-5 ring-1 ring-ink/5" aria-labelledby={`r-${kind}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id={`r-${kind}`} className="font-display text-2xl font-extrabold uppercase leading-none">
                    {k.name}
                  </h2>
                  <p className="mt-1 text-sm text-smoke">{cur ? `In effect since ${fmtDay(cur.effective_from, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'No rates in effect today'}</p>
                </div>
                <button type="button" onClick={() => setAdding(kind)} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-ink/15 hover:bg-mist">
                  <Plus className="size-4" aria-hidden="true" /> New version
                </button>
              </div>
              <p className="mt-3 text-sm text-smoke">{k.about}</p>
              {cur && (kind === 'tax' ? <Brackets brackets={cur.brackets} /> : (
                <dl className="tabular mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {k.fields.map(([key, l, t]) => (
                    <div key={key} className="flex justify-between gap-3 border-b border-ink/5 py-1">
                      <dt className="text-smoke">{l}</dt>
                      <dd className="font-semibold">{show(t, cur[key])}</dd>
                    </div>
                  ))}
                </dl>
              ))}
              {older.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-smoke hover:text-ink">{older.length} other version{older.length === 1 ? '' : 's'}</summary>
                  <ul className="mt-2 space-y-1 text-smoke">
                    {older.map((r) => (
                      <li key={r.id}>
                        From {fmtDay(r.effective_from, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {r.effective_from > today ? ' (upcoming)' : ''}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )
        })}
      </div>
      <AnimatePresence>{adding && <NewVersion key="v" kind={adding} base={current[adding]} onClose={() => setAdding(null)} onDone={load} />}</AnimatePresence>
    </>
  )
}

function Brackets({ brackets }) {
  return (
    <table className="tabular mt-3 w-full text-left text-sm">
      <thead className="text-xs font-bold uppercase tracking-[0.06em] text-smoke">
        <tr>
          <th className="py-1.5 font-bold">Taxable monthly pay over</th>
          <th className="py-1.5 text-right font-bold">Fixed tax</th>
          <th className="py-1.5 text-right font-bold">+ rate on excess</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/5">
        {brackets.map((b, i) => (
          <tr key={i}>
            <td className="py-1.5">{money(b.over)}</td>
            <td className="py-1.5 text-right">{money(b.base)}</td>
            <td className="py-1.5 text-right">{+(b.rate * 100).toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const num = (s) => (s === '' || s == null ? NaN : Number(s))

function NewVersion({ kind, base, onClose, onDone }) {
  const k = KINDS[kind]
  const [from, setFrom] = useState(manilaToday())
  const [notes, setNotes] = useState('')
  // Form values as text; percentages shown as percent.
  const [vals, setVals] = useState(() => Object.fromEntries(k.fields.map(([key, , t]) => [key, base?.[key] == null ? '' : String(t === 'pct' ? +(base[key] * 100).toFixed(4) : base[key])])))
  const [brackets, setBrackets] = useState(() => (base?.brackets ?? [{ over: 0, base: 0, rate: 0 }]).map((b) => ({ over: String(b.over), base: String(b.base), rate: String(+(b.rate * 100).toFixed(4)) })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    let config
    if (kind === 'tax') {
      const bs = brackets.map((b) => ({ over: num(b.over), base: num(b.base), rate: num(b.rate) / 100 }))
      if (bs.some((b) => [b.over, b.base, b.rate].some(Number.isNaN))) return setErr('Fill in every bracket.')
      bs.sort((a, b) => a.over - b.over)
      if (bs[0].over !== 0) return setErr('The first bracket must start at ₱0.')
      config = { period: 'monthly', brackets: bs }
    } else {
      config = {}
      for (const [key, l, t] of k.fields) {
        const v = num(vals[key])
        if (Number.isNaN(v) || v < 0) return setErr(`Enter ${l.toLowerCase()}.`)
        config[key] = t === 'pct' ? +(v / 100).toFixed(6) : v
      }
    }
    setBusy(true)
    const { error } = await supabase.from('payroll_rates').insert({ kind, effective_from: from, config, notes: notes.trim() || null })
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'There is already a version starting on that date.' : error.message)
    onDone()
    onClose()
  }

  return (
    <Sheet title={`New ${k.name} rates`} subtitle="Starts from the date you pick. Pre-filled with the current values." onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className={label}>
          Applies to pay dates from
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${field} tabular mt-1.5`} />
        </label>
        {kind === 'tax' ? (
          <fieldset>
            <legend className={label}>Brackets</legend>
            <div className="mt-1.5 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_5rem_2.25rem] gap-2 text-xs font-bold uppercase tracking-[0.06em] text-smoke">
                <span>Over ₱</span>
                <span>Fixed tax ₱</span>
                <span>Rate %</span>
                <span />
              </div>
              {brackets.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_5rem_2.25rem] gap-2">
                  {['over', 'base', 'rate'].map((key) => (
                    <input key={key} inputMode="decimal" aria-label={`Bracket ${i + 1} ${key}`} value={b[key]} onChange={(e) => /^\d*\.?\d{0,4}$/.test(e.target.value) && setBrackets(brackets.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)))} className={`${field} tabular h-10 px-2`} />
                  ))}
                  <button type="button" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))} disabled={brackets.length === 1} aria-label={`Remove bracket ${i + 1}`} className="press grid h-10 place-items-center rounded-lg text-smoke ring-1 ring-ink/10 hover:text-crimson disabled:opacity-30">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setBrackets([...brackets, { over: '', base: '', rate: '' }])} className="press flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 hover:text-ink">
                <Plus className="size-4" aria-hidden="true" /> Add bracket
              </button>
            </div>
          </fieldset>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {k.fields.map(([key, l, t]) => (
              <label key={key} className="block text-sm font-semibold">
                {l}
                <span className="relative mt-1.5 block">
                  {t === 'money' && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>}
                  <input inputMode="decimal" value={vals[key]} onChange={(e) => /^\d*\.?\d{0,4}$/.test(e.target.value) && setVals({ ...vals, [key]: e.target.value })} className={`${field} tabular ${t === 'money' ? 'pl-7' : 'pr-8'}`} />
                  {t === 'pct' && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-smoke">%</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        <label className={label}>
          Source or note <span className="font-normal text-smoke">(e.g. circular number)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} mt-1.5`} />
        </label>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>Add version</Submit>
      </form>
    </Sheet>
  )
}
