import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, Banknote, CalendarClock, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, History, Loader2, Paperclip, Pencil, Plus, Search, Settings2, Tags } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday, money, moneyInput, uuid } from '../lib/util.js'
import { EASE_OUT, Segmented, Sheet, fmtDateTime } from '../components/ui.jsx'
import { addDays } from '../components/RangePicker.jsx'

const field = 'h-11 w-full rounded-lg bg-paper px-3 ring-1 ring-ink/15 outline-none transition-shadow duration-150 placeholder:text-smoke/70 focus:ring-2 focus:ring-gold disabled:bg-mist disabled:text-smoke'
const label = 'block text-sm font-semibold'
const PAY = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' }

// Months as 'YYYY-MM' (Manila).
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7)
}
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const monthBounds = (m) => [`${m}-01`, addDays(`${shiftMonth(m, 1)}-01`, -1)]
const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })
// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0)

export default function Expenses() {
  const today = manilaToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [cats, setCats] = useState([])
  const [bills, setBills] = useState([])
  const [rows, setRows] = useState(null)
  const [billRows, setBillRows] = useState([])
  const [prevTotal, setPrevTotal] = useState(null)
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [open, setOpen] = useState(null) // { kind: 'expense', id?, preset? } | { kind: 'bills' } | { kind: 'cats' }

  const load = useCallback(async () => {
    const [from, to] = monthBounds(month)
    const [pf, pt] = monthBounds(shiftMonth(month, -1))
    const [c, b, e, fb, prev, pp] = await Promise.all([
      supabase.from('expense_categories').select('id, name, is_active').order('name'),
      supabase.from('recurring_expenses').select('*').order('name'),
      supabase.from('expenses').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('expenses').select('id, recurring_id, amount, expense_date').eq('for_month', from).eq('status', 'recorded'),
      supabase.from('expenses').select('amount').eq('status', 'recorded').gte('expense_date', pf).lte('expense_date', pt),
      supabase.from('profiles').select('id, full_name'),
    ])
    const err = [c, b, e, fb, prev].find((x) => x.error)?.error
    if (err) return setError(err.message)
    setError(null)
    setCats(c.data)
    setBills(b.data)
    setRows(e.data)
    setBillRows(fb.data)
    setPrevTotal(sum(prev.data))
    setPeople(Object.fromEntries((pp.data ?? []).map((p) => [p.id, p.full_name])))
  }, [month])
  useEffect(() => {
    load()
  }, [load])

  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]))
  const recorded = (rows ?? []).filter((r) => r.status === 'recorded')
  const total = sum(recorded)
  const byCat = Object.entries(recorded.reduce((m, r) => ((m[r.category_id] = (m[r.category_id] ?? 0) + Number(r.amount)), m), {})).sort((a, b) => b[1] - a[1])
  const activeBills = bills.filter((b) => b.is_active)
  const due = activeBills.filter((b) => !billRows.some((r) => r.recurring_id === b.id))
  const q = query.trim().toLowerCase()
  const shown = (rows ?? []).filter(
    (r) => (!catFilter || r.category_id === catFilter) && (!q || [r.description, r.vendor, r.reference_no].some((x) => x?.toLowerCase().includes(q))),
  )
  const current = month === today.slice(0, 7)
  const editing = open?.kind === 'expense' && open.id ? rows?.find((r) => r.id === open.id) : null

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl font-black uppercase leading-none">Expenses</h1>
          <p className="mt-1 text-smoke">Everything the gym spends. Edits are logged and nothing is ever deleted, only voided with a reason.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg bg-paper ring-1 ring-ink/10">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="press grid size-11 place-items-center text-smoke hover:text-ink">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <label className="relative">
              <span className="sr-only">Month</span>
              <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="tabular h-11 w-40 bg-transparent text-center font-semibold outline-none" />
            </label>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={current} aria-label="Next month" className="press grid size-11 place-items-center text-smoke hover:text-ink disabled:opacity-30">
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={() => setOpen({ kind: 'expense' })} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
            <Plus className="size-4" aria-hidden="true" /> Add expense
          </button>
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 lg:grid-cols-4">
        {[
          [`Spent in ${monthLabel(month).split(' ')[0]}`, rows ? money(total) : '–', rows ? `${recorded.length} expense${recorded.length === 1 ? '' : 's'}` : ''],
          ['Last month', prevTotal == null ? '–' : money(prevTotal), prevTotal == null || !rows ? '' : prevTotal ? `${total >= prevTotal ? '+' : '−'}${money(Math.abs(total - prevTotal))} this month` : 'Nothing recorded'],
          ['Biggest category', byCat[0] ? catName[byCat[0][0]] : '–', byCat[0] ? `${money(byCat[0][1])} · ${Math.round((byCat[0][1] / total) * 100)}%` : 'No expenses yet'],
          ['Bills not recorded', activeBills.length ? String(due.length) : '–', activeBills.length ? (due.length ? `${money(sum(due.map((b) => ({ amount: b.usual_amount ?? 0 }))))} usual total` : 'All bills recorded') : 'No monthly bills set up'],
        ].map(([k, v, note], i) => (
          <div key={k} className={`border-ink/8 p-5 ${i % 2 === 0 ? 'border-r' : ''} max-lg:[&:nth-child(-n+2)]:border-b lg:border-r lg:last:border-r-0`}>
            <dt className="text-sm font-semibold text-smoke">{k}</dt>
            <dd className="tabular mt-2 truncate font-display text-3xl font-black leading-none sm:text-4xl">{v}</dd>
            <dd className="tabular mt-1.5 text-xs text-smoke">{note}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Couldn't load expenses. {error}</span>
          <button type="button" onClick={load} className="press rounded-md bg-crimson px-3 py-1.5 font-semibold text-paper">
            Try again
          </button>
        </div>
      )}

      <section className="mt-6 rounded-xl bg-paper p-5 ring-1 ring-ink/5" aria-labelledby="bills-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="bills-title" className="font-display text-2xl font-extrabold uppercase leading-none">
              Monthly bills · {monthLabel(month)}
            </h2>
            <p className="mt-1 text-sm text-smoke">Tick off each bill once you've paid it. The real amount is entered each month.</p>
          </div>
          <button type="button" onClick={() => setOpen({ kind: 'bills' })} className="press flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 hover:text-ink">
            <Settings2 className="size-4" aria-hidden="true" /> {bills.length ? 'Edit bills' : 'Set up bills'}
          </button>
        </div>
        {activeBills.length === 0 ? (
          <p className="mt-4 rounded-lg bg-mist p-4 text-sm text-smoke">
            Add the bills you pay every month, like rent, electricity, water and internet, and they'll show up here each month as a checklist.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {activeBills.map((b) => {
              const paid = billRows.find((r) => r.recurring_id === b.id)
              const late = !paid && current && b.due_day && Number(today.slice(8)) > b.due_day
              return (
                <li key={b.id} className={`flex items-center gap-3 rounded-lg p-3 ring-1 ${paid ? 'bg-active/6 ring-active/20' : late ? 'bg-crimson/6 ring-crimson/25' : 'ring-ink/10'}`}>
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full ${paid ? 'bg-active text-paper' : late ? 'bg-crimson/12 text-crimson' : 'bg-mist text-smoke'}`}>
                    {paid ? <CircleCheck className="size-5" aria-hidden="true" /> : <CalendarClock className="size-5" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{b.name}</span>
                    <span className="tabular block text-xs text-smoke">
                      {paid ? `Paid ${money(paid.amount)} on ${fmtDay(paid.expense_date)}` : `${late ? 'Overdue · ' : ''}${b.due_day ? `due on the ${ordinal(b.due_day)}` : 'no due day'}${b.usual_amount ? ` · usually ${money(b.usual_amount)}` : ''}`}
                    </span>
                  </span>
                  {paid ? (
                    <button type="button" onClick={() => setOpen({ kind: 'expense', id: paid.id })} className="press shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-smoke hover:text-ink">
                      View
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setOpen({
                          kind: 'expense',
                          preset: { recurring_id: b.id, for_month: `${month}-01`, category_id: b.category_id, description: `${b.name} – ${monthLabel(month)}`, amount: b.usual_amount ? String(b.usual_amount) : '', vendor: b.vendor ?? '' },
                        })
                      }
                      className="press shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-paper"
                    >
                      Record
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-72">
          <span className="sr-only">Search expenses</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-smoke" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Description, supplier or OR #" className={`${field} pl-10`} />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={`${field} w-full font-semibold lg:w-56`}>
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setOpen({ kind: 'cats' })} className="press flex h-11 items-center gap-2 self-start rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 hover:text-ink lg:ml-auto lg:self-auto">
          <Tags className="size-4" aria-hidden="true" /> Categories
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {!rows && !error && (
          <div role="status" aria-label="Loading expenses" className="divide-y divide-ink/5">
            {Array.from({ length: 5 }, (_, k) => (
              <div key={k} className="skeleton h-16" style={{ animationDelay: `${k * 60}ms` }} />
            ))}
          </div>
        )}
        {rows && shown.length === 0 && (
          <p className="px-5 py-14 text-center text-smoke">{rows.length ? 'No expenses match.' : `Nothing recorded for ${monthLabel(month)} yet.`}</p>
        )}
        {shown.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Date</th>
                <th scope="col" className="px-3 py-3 font-bold">Expense</th>
                <th scope="col" className="px-3 py-3 font-bold">Category</th>
                <th scope="col" className="px-3 py-3 font-bold">Paid via</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {shown.map((r) => {
                const voided = r.status === 'voided'
                return (
                  <tr key={r.id} onClick={() => setOpen({ kind: 'expense', id: r.id })} className="group cursor-pointer transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3">
                    <td className="tabular px-5 py-3 text-smoke max-md:order-2 max-md:col-span-2 max-md:p-0 max-md:text-xs">{fmtDay(r.expense_date)}</td>
                    <td className="px-3 py-3 max-md:order-1 max-md:p-0">
                      <button type="button" onClick={(e) => (e.stopPropagation(), setOpen({ kind: 'expense', id: r.id }))} className={`text-left ${voided ? 'text-smoke' : ''}`}>
                        <span className="font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.description}</span>
                        {r.receipt_path && <Paperclip className="ml-1.5 inline size-3.5 text-smoke" aria-label="Has receipt" />}
                        {r.payroll_run_id && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ink/8 px-2 py-0.5 align-middle text-xs font-bold">
                            <Banknote className="size-3" aria-hidden="true" /> Payroll
                          </span>
                        )}
                        {(r.vendor || r.reference_no) && <span className="block text-xs text-smoke">{[r.vendor, r.reference_no && `Ref ${r.reference_no}`].filter(Boolean).join(' · ')}</span>}
                      </button>
                    </td>
                    <td className="px-3 py-3 max-md:hidden">{catName[r.category_id]}</td>
                    <td className="px-3 py-3 text-smoke max-md:hidden">{PAY[r.payment_method]}</td>
                    <td className="px-5 py-3 text-right max-md:order-1 max-md:p-0">
                      <span className="flex flex-col items-end gap-1">
                        <span className={`tabular font-display text-2xl font-black leading-none ${voided ? 'text-smoke line-through decoration-2' : ''}`}>{money(r.amount)}</span>
                        {voided && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-crimson/10 px-2 py-0.5 text-xs font-bold text-crimson">
                            <Ban className="size-3" aria-hidden="true" /> Voided
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {open?.kind === 'expense' && (open.id ? editing : true) && (
          <ExpenseSheet key="exp" expense={editing} preset={open.preset} cats={cats} people={people} today={today} onClose={() => setOpen(null)} onDone={load} />
        )}
        {open?.kind === 'bills' && <BillsSheet key="bills" bills={bills} cats={cats} onClose={() => setOpen(null)} onDone={load} />}
        {open?.kind === 'cats' && <CategoriesSheet key="cats" cats={cats} onClose={() => setOpen(null)} onDone={load} />}
      </AnimatePresence>
    </main>
  )
}

function Problem({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/10 px-3 py-2.5 text-sm font-semibold text-crimson">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </p>
  )
}

function Notice({ children }) {
  return (
    <motion.p role="status" className="flex items-start gap-2 rounded-lg bg-active/12 px-3 py-2.5 text-sm font-semibold text-[#0B6B35]" initial={{ opacity: 0, transform: 'translateY(-6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, ease: EASE_OUT }}>
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </motion.p>
  )
}

function Submit({ busy, children, disabled, tone = 'bg-ink text-paper' }) {
  return (
    <button type="submit" disabled={busy || disabled} className={`press flex h-12 w-full items-center justify-center gap-2 rounded-xl font-display text-xl font-black uppercase tracking-[0.03em] disabled:opacity-40 ${tone}`}>
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

const safeName = (n) => n.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60)

function ExpenseSheet({ expense, preset, cats, people, today, onClose, onDone }) {
  const create = !expense
  const voided = expense?.status === 'voided'
  const fromPayroll = Boolean(expense?.payroll_run_id)
  const locked = voided || fromPayroll
  const [tab, setTab] = useState('details')
  const [f, setF] = useState(() =>
    create
      ? { expense_date: today, category_id: '', description: '', amount: '', payment_method: 'cash', vendor: '', reference_no: '', notes: '', ...preset }
      : { ...expense, amount: Number(expense.amount).toFixed(2).replace(/\.00$/, ''), vendor: expense.vendor ?? '', reference_no: expense.reference_no ?? '', notes: expense.notes ?? '' },
  )
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const activeCats = cats.filter((c) => c.is_active || c.id === f.category_id)

  const viewReceipt = async () => {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(expense.receipt_path, 300)
    if (error) return setErr(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    setNotice(null)
    if (!f.category_id) return setErr('Pick a category.')
    if (!f.description.trim()) return setErr('Describe the expense.')
    if (!(Number(f.amount) > 0)) return setErr('Enter the amount.')
    if (file && file.size > 10 * 1024 * 1024) return setErr('Receipt file is over 10 MB.')
    setBusy(true)
    let receipt_path = expense?.receipt_path ?? null
    if (file) {
      const path = `${f.expense_date.slice(0, 7)}/${uuid()}-${safeName(file.name)}`
      const up = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type })
      if (up.error) {
        setBusy(false)
        return setErr(`Receipt upload failed: ${up.error.message}`)
      }
      receipt_path = path
    }
    const row = {
      expense_date: f.expense_date,
      category_id: f.category_id,
      description: f.description.trim(),
      amount: Number(f.amount),
      payment_method: f.payment_method,
      vendor: f.vendor.trim() || null,
      reference_no: f.reference_no.trim() || null,
      notes: f.notes.trim() || null,
      receipt_path,
    }
    const res = create ? await supabase.from('expenses').insert({ ...row, recurring_id: preset?.recurring_id ?? null, for_month: preset?.for_month ?? null }) : await supabase.from('expenses').update(row).eq('id', expense.id)
    setBusy(false)
    if (res.error) return setErr(res.error.code === '23505' ? 'This bill is already recorded for that month.' : res.error.message)
    onDone()
    if (create) onClose()
    else {
      setFile(null)
      setNotice('Saved. The change is in the history.')
    }
  }

  return (
    <Sheet
      title={create ? (preset?.recurring_id ? 'Record bill' : 'Add expense') : expense.description}
      subtitle={create ? 'Admins only. Every edit is logged.' : `${money(expense.amount)} · ${fmtDay(expense.expense_date)}${voided ? ' · voided' : ''}`}
      onClose={onClose}
      header={!create && <Segmented id="exp-tab" dark className="mt-4" value={tab} onChange={setTab} options={[['details', 'Details', Pencil], ['history', 'History', History]]} />}
    >
      {tab === 'history' && expense ? (
        <ExpenseHistory expense={expense} cats={cats} people={people} />
      ) : (
        <>
          {voided && (
            <div role="status" className="mb-4 rounded-xl bg-crimson/10 p-4 text-sm ring-1 ring-crimson/20">
              <p className="font-semibold">Voided: “{expense.void_reason}”</p>
              <p className="text-smoke">
                {fmtDateTime(expense.voided_at)} by {people[expense.voided_by] ?? 'an admin'}. It no longer counts in totals and can't be edited.
              </p>
            </div>
          )}
          {fromPayroll && (
            <div role="note" className="mb-4 rounded-xl bg-paper p-4 text-sm ring-1 ring-ink/10">
              <p className="flex items-center gap-2 font-semibold">
                <Banknote className="size-4" aria-hidden="true" /> Posted by a finalized pay run
              </p>
              <p className="mt-1 text-smoke">Payroll entries can only be changed by voiding the pay run, so payslips and expenses always agree.</p>
              <Link to={`/payroll/runs/${expense.payroll_run_id}`} className="mt-2 inline-block font-semibold underline decoration-gold decoration-2 underline-offset-4">
                Open the pay run
              </Link>
            </div>
          )}
          <form onSubmit={save} className="space-y-4">
            <AnimatePresence>{notice && <Notice>{notice}</Notice>}</AnimatePresence>
            <fieldset disabled={locked} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                  Date paid
                  <input type="date" value={f.expense_date} max={today} onChange={(e) => e.target.value && set('expense_date')(e.target.value)} className={`${field} tabular mt-1.5`} />
                </label>
                <label className={label}>
                  Amount
                  <span className="relative mt-1.5 block">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
                    <input inputMode="decimal" autoFocus={create && !preset} value={f.amount} onChange={moneyInput(set('amount'))} className={`${field} tabular pl-7 text-lg`} />
                  </span>
                </label>
              </div>
              <label className={label}>
                Category
                <select value={f.category_id} onChange={(e) => set('category_id')(e.target.value)} className={`${field} mt-1.5`}>
                  <option value="">Pick a category</option>
                  {activeCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Description
                <input value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="e.g. VECO electricity, October" className={`${field} mt-1.5`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                  Paid via
                  <select value={f.payment_method} onChange={(e) => set('payment_method')(e.target.value)} className={`${field} mt-1.5`}>
                    {Object.entries(PAY).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  OR / invoice #
                  <input value={f.reference_no} onChange={(e) => set('reference_no')(e.target.value)} className={`${field} mt-1.5`} />
                </label>
              </div>
              <label className={label}>
                Supplier or payee <span className="font-normal text-smoke">(optional)</span>
                <input value={f.vendor} onChange={(e) => set('vendor')(e.target.value)} className={`${field} mt-1.5`} />
              </label>
              <div>
                <p className={label}>Receipt or bill</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {expense?.receipt_path && (
                    <button type="button" onClick={viewReceipt} className="press flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-ink/15">
                      <Paperclip className="size-4" aria-hidden="true" /> View current
                    </button>
                  )}
                  <label className="press flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-paper px-3 text-sm font-semibold text-smoke ring-1 ring-ink/15 hover:text-ink">
                    <Paperclip className="size-4" aria-hidden="true" />
                    {file ? file.name : expense?.receipt_path ? 'Replace' : 'Attach photo or PDF'}
                    <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] ?? null)} className="sr-only" />
                  </label>
                </div>
                <p className="mt-1 text-sm text-smoke">Optional. Kept private; only admins can open it. Up to 10 MB.</p>
              </div>
              <label className={label}>
                Notes <span className="font-normal text-smoke">(optional)</span>
                <textarea value={f.notes} onChange={(e) => set('notes')(e.target.value)} rows={2} className={`${field} mt-1.5 h-auto py-2.5`} />
              </label>
            </fieldset>
            {err && <Problem>{err}</Problem>}
            {!locked && <Submit busy={busy}>{create ? (preset?.recurring_id ? 'Record bill' : 'Add expense') : 'Save changes'}</Submit>}
          </form>
          {expense && !locked && <VoidExpense expense={expense} onDone={onDone} />}
        </>
      )}
    </Sheet>
  )
}

function VoidExpense({ expense, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return setErr('Say why, e.g. entered twice or wrong amount.')
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('void_expense', { p_expense_id: expense.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl p-5 ring-1 ring-crimson/25">
      <h3 className="font-display text-2xl font-extrabold uppercase leading-none">Void this expense</h3>
      <p className="text-sm text-smoke">For an entry made by mistake. It stays on record, marked voided, and stops counting in totals and reports. To fix a typo, edit it above instead.</p>
      <label className="block text-sm font-semibold">
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered twice, wrong month…" className={`${field} mt-1.5`} />
      </label>
      {err && <Problem>{err}</Problem>}
      <Submit busy={busy} tone="bg-crimson text-paper">
        <Ban className="size-5" aria-hidden="true" /> Void {money(expense.amount)}
      </Submit>
    </form>
  )
}

const EXP_FIELD = { expense_date: 'Date', category_id: 'Category', description: 'Description', amount: 'Amount', payment_method: 'Paid via', vendor: 'Supplier', reference_no: 'OR #', receipt_path: 'Receipt', notes: 'Notes', status: 'Status', void_reason: 'Void reason' }

function ExpenseHistory({ expense, cats, people }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    supabase
      .from('expense_changes')
      .select('id, field, old_value, new_value, changed_by, changed_at')
      .eq('expense_id', expense.id)
      .order('changed_at', { ascending: false })
      .then(({ data, error }) => (error ? setErr(error.message) : setItems(data)))
  }, [expense.id, expense.updated_at])
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]))
  const val = (f, v) => (v == null || v === '' ? '–' : f === 'amount' ? money(v) : f === 'category_id' ? (catName[v] ?? '?') : f === 'payment_method' ? (PAY[v] ?? v) : f === 'receipt_path' ? 'file attached' : f === 'expense_date' ? fmtDay(v) : v)
  if (err) return <Problem>{err}</Problem>
  if (!items) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-smoke" aria-label="Loading history" />
  return (
    <ol className="space-y-1">
      {items.map((c) => (
        <li key={c.id} className="rounded-lg px-2 py-2.5 text-sm">
          <p className="font-semibold">{c.field === 'created' ? `Recorded at ${money(c.new_value)}` : `${EXP_FIELD[c.field] ?? c.field}: ${val(c.field, c.old_value)} → ${val(c.field, c.new_value)}`}</p>
          <p className="text-xs text-smoke">
            {fmtDateTime(c.changed_at)} · {people[c.changed_by] ?? 'Someone'}
          </p>
        </li>
      ))}
    </ol>
  )
}

function BillsSheet({ bills, cats, onClose, onDone }) {
  const blank = { name: '', category_id: '', usual_amount: '', vendor: '', due_day: '', is_active: true }
  const [edit, setEdit] = useState(null) // bill being edited, or blank for new
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]))

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!edit.name.trim() || !edit.category_id) return setErr('Name and category are required.')
    const day = edit.due_day === '' ? null : Number(edit.due_day)
    if (day != null && !(day >= 1 && day <= 31)) return setErr('Due day must be 1 to 31.')
    const row = { name: edit.name.trim(), category_id: edit.category_id, usual_amount: edit.usual_amount === '' ? null : Number(edit.usual_amount), vendor: edit.vendor?.trim() || null, due_day: day, is_active: edit.is_active }
    setBusy(true)
    const res = edit.id ? await supabase.from('recurring_expenses').update(row).eq('id', edit.id) : await supabase.from('recurring_expenses').insert(row)
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    setEdit(null)
    onDone()
  }

  return (
    <Sheet title="Monthly bills" subtitle="Bills that come every month. Each month you record the real amount." onClose={onClose}>
      {!edit ? (
        <>
          <ul className="space-y-2">
            {bills.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setEdit({ ...b, usual_amount: b.usual_amount == null ? '' : String(b.usual_amount), due_day: b.due_day == null ? '' : String(b.due_day), vendor: b.vendor ?? '' })} className={`press flex w-full items-center justify-between gap-3 rounded-lg bg-paper p-3 text-left ring-1 ring-ink/8 hover:ring-ink/25 ${b.is_active ? '' : 'opacity-60'}`}>
                  <span>
                    <span className="block font-semibold">{b.name}</span>
                    <span className="text-xs text-smoke">
                      {catName[b.category_id]}
                      {b.due_day ? ` · due day ${b.due_day}` : ''}
                      {b.is_active ? '' : ' · stopped'}
                    </span>
                  </span>
                  <span className="tabular text-sm font-semibold">{b.usual_amount ? money(b.usual_amount) : 'varies'}</span>
                </button>
              </li>
            ))}
          </ul>
          {!bills.length && <p className="text-smoke">No monthly bills yet.</p>}
          <button type="button" onClick={() => setEdit(blank)} className="press mt-4 flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
            <Plus className="size-4" aria-hidden="true" /> Add a bill
          </button>
        </>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <label className={label}>
            Bill name
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. VECO electricity" className={`${field} mt-1.5`} />
          </label>
          <label className={label}>
            Category
            <select value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })} className={`${field} mt-1.5`}>
              <option value="">Pick a category</option>
              {cats
                .filter((c) => c.is_active || c.id === edit.category_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Usual amount <span className="font-normal text-smoke">(optional)</span>
              <span className="relative mt-1.5 block">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
                <input inputMode="decimal" value={edit.usual_amount} onChange={moneyInput((v) => setEdit({ ...edit, usual_amount: v }))} className={`${field} tabular pl-7`} />
              </span>
            </label>
            <label className={label}>
              Due day of month
              <input inputMode="numeric" value={edit.due_day} onChange={(e) => /^\d{0,2}$/.test(e.target.value) && setEdit({ ...edit, due_day: e.target.value })} placeholder="1 to 31" className={`${field} tabular mt-1.5`} />
            </label>
          </div>
          <label className={label}>
            Supplier or payee <span className="font-normal text-smoke">(optional)</span>
            <input value={edit.vendor} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} className={`${field} mt-1.5`} />
          </label>
          {edit.id && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-paper p-4 ring-1 ring-ink/5">
              <span>
                <span className="block font-semibold">Still paying this bill</span>
                <span className="text-sm text-smoke">Turn off when it stops; past months stay recorded.</span>
              </span>
              <input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} className="size-5 shrink-0 accent-[#19171B]" />
            </label>
          )}
          {err && <Problem>{err}</Problem>}
          <Submit busy={busy}>{edit.id ? 'Save bill' : 'Add bill'}</Submit>
          <button type="button" onClick={() => (setEdit(null), setErr(null))} className="press h-11 w-full rounded-lg font-semibold text-smoke ring-1 ring-ink/10">
            Back to list
          </button>
        </form>
      )}
    </Sheet>
  )
}

function CategoriesSheet({ cats, onClose, onDone }) {
  const [name, setName] = useState('')
  const [names, setNames] = useState(() => Object.fromEntries(cats.map((c) => [c.id, c.name])))
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const run = async (key, q) => {
    setBusy(key)
    setErr(null)
    const { error } = await q
    setBusy(null)
    if (error) return setErr(error.code === '23505' ? 'That category already exists.' : error.message), false
    onDone()
    return true
  }
  const add = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    if (await run('new', supabase.from('expense_categories').insert({ name: name.trim() }))) setName('')
  }
  return (
    <Sheet title="Expense categories" subtitle="Rename or hide. Hidden categories stay on past expenses." onClose={onClose}>
      <form onSubmit={add} className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">New category</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className={field} />
        </label>
        <button type="submit" disabled={!name.trim() || busy === 'new'} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink disabled:opacity-50">
          <Plus className="size-4" aria-hidden="true" /> Add
        </button>
      </form>
      {err && (
        <div className="mt-3">
          <Problem>{err}</Problem>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {cats.map((c) => {
          const changed = names[c.id]?.trim() && names[c.id].trim() !== c.name
          return (
            <li key={c.id} className={`flex items-center gap-2 rounded-lg bg-paper p-2 ring-1 ring-ink/8 ${c.is_active ? '' : 'opacity-60'}`}>
              <label className="flex-1">
                <span className="sr-only">Category name</span>
                <input value={names[c.id] ?? ''} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} className="h-10 w-full rounded-md px-2 font-semibold outline-none focus:ring-2 focus:ring-gold" />
              </label>
              {changed && (
                <button type="button" onClick={() => run(c.id, supabase.from('expense_categories').update({ name: names[c.id].trim() }).eq('id', c.id))} className="press h-9 rounded-md bg-ink px-3 text-sm font-semibold text-paper">
                  Save
                </button>
              )}
              <button type="button" onClick={() => run(c.id + 'a', supabase.from('expense_categories').update({ is_active: !c.is_active }).eq('id', c.id))} className="press h-9 rounded-md px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 hover:text-ink">
                {c.is_active ? 'Hide' : 'Show'}
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
