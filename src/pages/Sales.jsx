import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, CircleAlert, Loader2, Printer, Search } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { money } from '../lib/util.js'
import { EASE_OUT, Sheet, fmtDateTime } from '../components/ui.jsx'
import RangePicker, { addDays, presets } from '../components/RangePicker.jsx'
import { useAuth } from '../auth.jsx'
import { printReceipt, saleReceipt, testReceipt } from '../lib/printReceipt.js'

const PAGE = 50
const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
const receiptNo = (n) => '#' + String(n).padStart(5, '0')
const dayStart = (d) => `${d}T00:00:00+08:00` // Manila midnight
const select = 'h-11 rounded-lg bg-paper px-3 text-sm font-semibold ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-gold'

export default function Sales() {
  const { isAdmin } = useAuth() // staff only see their own receipts (sales read policy)
  const opts = useMemo(presets, [])
  const [range, setRange] = useState({ key: 'today', from: opts[0][2], to: opts[0][3] })
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [staff, setStaff] = useState('')
  const [people, setPeople] = useState([])
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(0)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)
  const req = useRef(0)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .order('full_name')
      .then(({ data }) => setPeople(data ?? []))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim().replace(/^#/, '')), 300)
    return () => clearTimeout(t)
  }, [typed])

  const byReceipt = /^\d+$/.test(search)
  const query = useCallback(
    (offset) => {
      let q = supabase
        .from('sales')
        .select('id, sale_no, sold_at, payment_method, payment_ref, subtotal, discount, total, amount_tendered, change_due, customer_name, note, status, voided_at, voided_by, void_reason, staff_id, sale_items(product_name, qty, unit_price, line_total)', { count: 'exact' })
        .order('sold_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      // A receipt number finds that receipt whatever the date range.
      if (byReceipt) return q.eq('sale_no', Number(search))
      q = q.gte('sold_at', dayStart(range.from)).lt('sold_at', dayStart(addDays(range.to, 1)))
      if (search) q = q.ilike('customer_name', `%${search}%`)
      if (method) q = q.eq('payment_method', method)
      if (status) q = q.eq('status', status)
      if (staff) q = q.eq('staff_id', staff)
      return q
    },
    [range.from, range.to, search, byReceipt, method, status, staff],
  )

  const reload = useCallback(async () => {
    const id = ++req.current
    setBusy(true)
    const [list, rep] = await Promise.all([query(0), isAdmin ? supabase.rpc('sales_report', { p_from: range.from, p_to: range.to }) : { error: true }])
    if (id !== req.current) return // a newer filter won
    setBusy(false)
    if (list.error) return setError(list.error.message)
    setError(null)
    setRows(list.data)
    setCount(list.count ?? list.data.length)
    if (!rep.error) setSummary(rep.data)
  }, [query, range.from, range.to, isAdmin])
  useEffect(() => {
    reload()
  }, [reload])
  // Live: refetch when a sale is rung up or voided anywhere. Debounced because one checkout fires an insert and an update.
  useEffect(() => {
    let t
    const ch = supabase
      .channel('sales-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        clearTimeout(t)
        t = setTimeout(reload, 500)
      })
      .subscribe()
    return () => {
      clearTimeout(t)
      supabase.removeChannel(ch)
    }
  }, [reload])

  const more = async () => {
    setBusy(true)
    const { data, error } = await query(rows.length)
    setBusy(false)
    if (error) return setError(error.message)
    setRows((r) => [...r, ...data])
  }

  const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]))
  const open = rows?.find((r) => r.id === openId)
  const pay = (keys) => (summary?.payments ?? []).filter((p) => keys.includes(p.method)).reduce((s, p) => s + Number(p.total), 0)
  const filtered = method || status || staff || search

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-5xl font-black uppercase leading-none">Sales</h1>
          <p className="mt-1 text-smoke">{isAdmin ? 'Every receipt, who rang it up and how it was paid. Open one to void it.' : 'Receipts you rang up.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => printReceipt(testReceipt())} className="press flex h-11 items-center gap-2 rounded-lg px-4 font-semibold ring-1 ring-ink/15">
            <Printer className="size-4" aria-hidden="true" /> Print test receipt
          </button>
          <RangePicker opts={opts} range={range} setRange={setRange} />
        </div>
      </header>

      {isAdmin && (
      <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Sales', summary && money(summary.totals.revenue), summary && `${summary.totals.receipts} receipt${summary.totals.receipts === 1 ? '' : 's'}`],
          ['Cash', summary && money(pay(['cash'])), 'Should be in the drawer'],
          ['GCash + Maya', summary && money(pay(['gcash', 'maya'])), 'E-wallets'],
          ['Card + bank', summary && money(pay(['card', 'bank_transfer'])), 'Check your statements'],
          ['Other', summary && money(pay(['other'])), 'Anything else'],
          ['Voided', summary && String(summary.voids.count), summary && (summary.voids.count ? `${money(summary.voids.total)} reversed` : 'None')],
        ].map(([k, v, note]) => (
          <div key={k} className="border-ink/8 p-5 not-last:border-r max-md:[&:nth-child(2n)]:border-r-0 md:max-xl:[&:nth-child(3n)]:border-r-0 max-xl:border-b">
            <dt className="text-sm font-semibold text-smoke">{k}</dt>
            <dd className="tabular mt-2 font-display text-3xl font-black leading-none xl:text-4xl">{v ?? '–'}</dd>
            <dd className="tabular mt-1.5 text-xs text-smoke">{note}</dd>
          </div>
        ))}
      </dl>
      )}
      {isAdmin && filtered && <p className="mt-2 text-xs text-smoke">Totals above cover the whole date range; the filters below only narrow the list.</p>}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-72">
          <span className="sr-only">Search receipt number or customer</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-smoke" aria-hidden="true" />
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Receipt # or customer" className="h-11 w-full rounded-lg bg-paper pr-3 pl-10 ring-1 ring-ink/10 outline-none placeholder:text-smoke focus:ring-2 focus:ring-gold" />
        </label>
        <div className={`grid ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'} gap-2 lg:flex`}>
          <label>
            <span className="sr-only">Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={byReceipt} className={`${select} w-full`}>
              <option value="">All payments</option>
              {Object.entries(METHOD).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {isAdmin && (
          <label>
            <span className="sr-only">Staff</span>
            <select value={staff} onChange={(e) => setStaff(e.target.value)} disabled={byReceipt} className={`${select} w-full`}>
              <option value="">All staff</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          )}
          <label>
            <span className="sr-only">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={byReceipt} className={`${select} w-full`}>
              <option value="">All receipts</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
            </select>
          </label>
        </div>
        <p className="tabular text-sm text-smoke lg:ml-auto" aria-live="polite">
          {busy ? <Loader2 className="inline size-4 animate-spin" aria-label="Loading" /> : rows && `${count} receipt${count === 1 ? '' : 's'}${byReceipt ? ' matching that number, any date' : ''}`}
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Couldn't load sales. {error}</span>
          <button type="button" onClick={reload} className="press rounded-md bg-crimson px-3 py-1.5 font-semibold text-paper">
            Try again
          </button>
        </div>
      )}

      <div className={`mt-4 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 transition-opacity duration-200 ${busy && rows ? 'opacity-60' : ''}`}>
        {!rows && !error && (
          <div role="status" aria-label="Loading sales" className="divide-y divide-ink/5">
            {Array.from({ length: 6 }, (_, k) => (
              <div key={k} className="skeleton h-16" style={{ animationDelay: `${k * 60}ms` }} />
            ))}
          </div>
        )}
        {rows && rows.length === 0 && <p className="px-5 py-14 text-center text-smoke">{filtered ? 'No receipts match these filters.' : 'No sales in this range yet.'}</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Receipt</th>
                <th scope="col" className="px-3 py-3 font-bold">Items</th>
                <th scope="col" className="px-3 py-3 font-bold">Rang up by</th>
                <th scope="col" className="px-3 py-3 font-bold">Paid</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((r) => (
                <SaleRow key={r.id} r={r} who={names[r.staff_id]} onOpen={() => setOpenId(r.id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows && rows.length < count && (
        <button type="button" onClick={more} disabled={busy} className="press mx-auto mt-4 flex h-11 items-center gap-2 rounded-lg bg-paper px-5 text-sm font-semibold ring-1 ring-ink/10 disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Show more ({count - rows.length} left)
        </button>
      )}

      <AnimatePresence>{open && <ReceiptSheet key="sheet" r={open} names={names} canVoid={isAdmin} onClose={() => setOpenId(null)} onVoided={reload} />}</AnimatePresence>
    </main>
  )
}

function itemsSummary(items) {
  const first = items.slice(0, 2).map((i) => `${i.qty}× ${i.product_name}`).join(', ')
  return items.length > 2 ? `${first} +${items.length - 2} more` : first
}

function VoidBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-crimson/10 px-2 py-0.5 text-xs font-bold text-crimson">
      <Ban className="size-3" aria-hidden="true" /> Voided
    </span>
  )
}

function SaleRow({ r, who, onOpen }) {
  const voided = r.status === 'voided'
  return (
    <tr onClick={onOpen} className="group cursor-pointer transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3">
      <td className="px-5 py-3 max-md:p-0">
        <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className="text-left">
          <span className="tabular font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{receiptNo(r.sale_no)}</span>
          <span className="tabular block text-xs text-smoke">
            {fmtDateTime(r.sold_at)}
            {r.customer_name && ` · ${r.customer_name}`}
            {r.payment_ref && <span className="md:hidden"> · GCash …{r.payment_ref}</span>}
          </span>
        </button>
      </td>
      <td className={`px-3 py-3 max-md:order-3 max-md:col-span-2 max-md:p-0 max-md:pt-1 ${voided ? 'text-smoke' : ''}`}>{itemsSummary(r.sale_items)}</td>
      <td className="px-3 py-3 text-smoke max-md:hidden">{who ?? 'Unknown'}</td>
      <td className="px-3 py-3 max-md:hidden">
        {METHOD[r.payment_method]}
        {r.payment_ref && <span className="tabular block text-xs text-smoke">ref …{r.payment_ref}</span>}
      </td>
      <td className="px-5 py-3 text-right max-md:p-0">
        <span className="flex flex-col items-end gap-1">
          <span className={`tabular font-display text-2xl font-black leading-none ${voided ? 'text-smoke line-through decoration-2' : ''}`}>{money(r.total)}</span>
          {voided && <VoidBadge />}
        </span>
      </td>
    </tr>
  )
}

function ReceiptSheet({ r, names, canVoid, onClose, onVoided }) {
  const voided = r.status === 'voided'
  const cash = r.payment_method === 'cash'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const voidSale = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return setErr('Say why, e.g. wrong item or customer changed their mind.')
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('void_sale', { p_sale_id: r.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    onVoided()
  }

  return (
    <Sheet title={`Receipt ${receiptNo(r.sale_no)}`} subtitle={`${fmtDateTime(r.sold_at)} · ${names[r.staff_id] ?? 'Unknown'}`} onClose={onClose}>
      <AnimatePresence initial={false}>
        {voided && (
          <motion.div
            role="status"
            className="mb-4 rounded-xl bg-crimson/10 p-4 text-sm ring-1 ring-crimson/20"
            initial={{ opacity: 0, transform: 'translateY(-6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <VoidBadge />
            <p className="mt-2 font-semibold">“{r.void_reason}”</p>
            <p className="text-smoke">
              {fmtDateTime(r.voided_at)} by {names[r.voided_by] ?? 'an admin'}. Stock was put back and it's left out of totals.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-xl bg-paper p-5 ring-1 ring-ink/5">
        <ul className="tabular space-y-2 text-sm">
          {r.sale_items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span>
                <span className="text-smoke">{i.qty} ×</span> {i.product_name} <span className="text-smoke">@ {money(i.unit_price)}</span>
              </span>
              <span>{money(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="tabular mt-4 space-y-1.5 border-t border-ink/10 pt-3 text-sm">
          {Number(r.discount) > 0 && (
            <>
              <Line k="Subtotal" v={money(r.subtotal)} />
              <Line k="Discount" v={`−${money(r.discount)}`} />
            </>
          )}
          <div className="flex items-end justify-between pt-1">
            <dt className="font-display text-xl font-extrabold uppercase">Total</dt>
            <dd className={`font-display text-4xl font-black leading-none ${voided ? 'text-smoke line-through decoration-2' : ''}`}>{money(r.total)}</dd>
          </div>
          <Line k="Paid by" v={METHOD[r.payment_method]} />
          {r.payment_ref && <Line k="GCash ref (last 4)" v={r.payment_ref} />}
          {cash && r.amount_tendered != null && (
            <>
              <Line k="Cash received" v={money(r.amount_tendered)} />
              <Line k="Change given" v={money(r.change_due ?? 0)} />
            </>
          )}
          {r.customer_name && <Line k="Customer" v={r.customer_name} />}
          {r.note && <Line k="Note" v={r.note} />}
        </dl>
      </div>

      {/* Voided sales still print, marked VOIDED (see saleReceipt). */}
      <button
        type="button"
        onClick={() => printReceipt(saleReceipt(r, { cashier: names[r.staff_id], method: METHOD[r.payment_method], banner: 'REPRINT' }))}
        className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg font-semibold ring-1 ring-ink/15"
      >
        <Printer className="size-4" aria-hidden="true" /> Reprint receipt
      </button>

      {canVoid && !voided && (
        <form onSubmit={voidSale} className="mt-6 space-y-3 rounded-xl p-5 ring-1 ring-crimson/25">
          <h3 className="font-display text-2xl font-extrabold uppercase leading-none">Void this sale</h3>
          <p className="text-sm text-smoke">For a mistake or a refund. The items go back into stock and the sale drops out of totals and reports. The receipt stays here, marked voided. This can't be undone.</p>
          <label className="block text-sm font-semibold">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong item, refund, rang up twice…" className="mt-1.5 h-11 w-full rounded-lg bg-paper px-3 ring-1 ring-ink/15 outline-none placeholder:text-smoke/70 focus:ring-2 focus:ring-gold" />
          </label>
          {err && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/10 px-3 py-2.5 text-sm font-semibold text-crimson">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {err}
            </p>
          )}
          <button type="submit" disabled={busy} className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-crimson font-display text-xl font-black uppercase tracking-[0.03em] text-paper disabled:opacity-60">
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Ban className="size-5" aria-hidden="true" />} Void {money(r.total)}
          </button>
        </form>
      )}
    </Sheet>
  )
}

function Line({ k, v }) {
  return (
    <div className="flex justify-between gap-3 text-smoke">
      <dt>{k}</dt>
      <dd className="text-right text-ink">{v}</dd>
    </div>
  )
}
