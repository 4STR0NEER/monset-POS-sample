import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { animate, createScope, svg } from 'animejs'
import { CircleAlert, CircleCheck, Loader2, Minus, Plus, Search, ShoppingBag, Tag, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday, money, moneyInput, quickCash, round2, uuid } from '../lib/util.js'
import { CountUp, EASE_OUT, stockOf } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'
import { printReceipt, saleReceipt } from '../lib/printReceipt.js'
import { RECEIPT } from '../config/receipt.js'

const METHODS = [
  ['cash', 'Cash'],
  ['gcash', 'GCash'],
  ['maya', 'Maya'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank'],
  ['other', 'Other'],
]
const METHOD_LABEL = Object.fromEntries(METHODS)

export default function Register() {
  const { isAdmin, profile } = useAuth()
  const [products, setProducts] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [today, setToday] = useState(null)
  const [cat, setCat] = useState('All')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ id, qty }] in the order items were added
  const [method, setMethod] = useState('cash')
  const [tendered, setTendered] = useState('')
  const [gcashRef, setGcashRef] = useState('') // last 4 digits of the GCash reference
  const [discount, setDiscount] = useState('')
  const [customer, setCustomer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [sheet, setSheet] = useState(false)
  // One ref per checkout, reused on retries so a dropped connection can't record the sale twice.
  const clientRef = useRef(uuid())
  const searchRef = useRef(null)

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      supabase
        .from('products')
        .select('id, code, name, category, kind, selling_price, stock_qty, reorder_level')
        .eq('is_active', true)
        .order('category')
        .order('name'),
      // Takings are admin-only; staff never request them.
      isAdmin ? supabase.from('v_daily_sales').select('receipts, revenue').eq('sale_date', manilaToday()).maybeSingle() : { error: true },
    ])
    if (p.error) setLoadError(p.error.message)
    else {
      setLoadError(null)
      setProducts(p.data)
    }
    if (!t.error) setToday(t.data ?? { receipts: 0, revenue: 0 })
  }, [isAdmin])
  useEffect(() => {
    load()
  }, [load])

  // Keep search focused for a USB/Bluetooth barcode scanner, but not on touch screens where it pops the keyboard.
  const focusSearch = () => matchMedia('(pointer: fine)').matches && searchRef.current?.focus()
  useEffect(() => {
    focusSearch()
  }, [])

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const categories = useMemo(() => ['All', ...new Set((products ?? []).map((p) => p.category))], [products])
  // [[category, products[]]], already sorted by category from the query.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map()
    for (const p of products ?? []) {
      if ((cat !== 'All' && p.category !== cat) || (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q))) continue
      out.set(p.category, [...(out.get(p.category) ?? []), p])
    }
    return [...out]
  }, [products, cat, query])
  const shown = groups.flatMap(([, ps]) => ps)

  const lines = cart.filter((l) => byId.has(l.id)).map((l) => ({ ...byId.get(l.id), qty: l.qty }))
  const qtyIn = (id) => cart.find((l) => l.id === id)?.qty ?? 0
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.selling_price, 0))
  const disc = Number(discount) || 0
  const discTooBig = disc > subtotal
  const total = round2(Math.max(subtotal - disc, 0))
  // Blank tendered means the customer paid the exact amount.
  const paid = method === 'cash' ? (tendered === '' ? total : Number(tendered)) : null
  const change = paid == null ? null : round2(paid - total)
  const refMissing = method === 'gcash' && !/^\d{4}$/.test(gcashRef)
  const canCharge = lines.length > 0 && !busy && !discTooBig && !refMissing && (change == null || change >= 0)

  const maxQty = (p) => (p.kind === 'good' ? p.stock_qty : Infinity)
  const add = (p) => {
    if (qtyIn(p.id) >= maxQty(p)) return
    setError(null)
    setCart((c) => (c.some((l) => l.id === p.id) ? c.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id: p.id, qty: 1 }]))
  }
  const setQty = (p, qty) => {
    setError(null)
    setCart((c) => (qty <= 0 ? c.filter((l) => l.id !== p.id) : c.map((l) => (l.id === p.id ? { ...l, qty: Math.min(qty, maxQty(p)) } : l))))
  }

  // Enter in search adds an exact code match (barcode scanners type the code + Enter) or the only result.
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return
    const q = query.trim().toLowerCase()
    const hit = shown.find((p) => p.code.toLowerCase() === q) ?? (shown.length === 1 ? shown[0] : null)
    if (hit) {
      add(hit)
      setQuery('')
    }
  }

  const charge = async () => {
    if (!canCharge) return
    setBusy(true)
    setError(null)
    const { data: id, error } = await supabase.rpc('record_sale', {
      p_items: lines.map((l) => ({ product_id: l.id, qty: l.qty })),
      p_payment_method: method,
      p_discount: disc,
      p_amount_tendered: paid,
      p_customer_name: customer.trim() || null,
      p_client_ref: clientRef.current,
      p_payment_ref: method === 'gcash' ? gcashRef : null,
    })
    if (error) {
      setBusy(false)
      setError(/fetch|network/i.test(error.message) ? "Connection problem. Tap Charge again, it won't be recorded twice." : error.message)
      load()
      return
    }
    const { data: sale } = await supabase
      .from('sales')
      .select('sale_no, sold_at, subtotal, discount, total, amount_tendered, change_due, payment_method, payment_ref, customer_name, sale_items(product_name, qty, line_total)')
      .eq('id', id)
      .single()
    // The sale is saved either way; fall back to what the register knows if the read-back failed.
    setReceipt(
      sale ?? {
        sale_no: null,
        subtotal,
        discount: disc,
        total,
        amount_tendered: paid,
        change_due: change,
        payment_method: method,
        payment_ref: method === 'gcash' ? gcashRef : null,
        customer_name: customer.trim() || null,
        sale_items: lines.map((l) => ({ product_name: l.name, qty: l.qty, line_total: l.qty * l.selling_price })),
      },
    )
    clientRef.current = uuid()
    setCart([])
    setTendered('')
    setGcashRef('')
    setDiscount('')
    setCustomer('')
    setMethod('cash')
    setSheet(false)
    setBusy(false)
    load()
  }

  const newSale = useCallback(() => {
    setReceipt(null)
    focusSearch()
  }, [])

  return (
    <>
      <div className="lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_25rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section className="min-w-0 px-4 pt-4 pb-28 sm:px-6 lg:overflow-y-auto lg:pb-8">
          <h1 className="sr-only">Register</h1>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="relative block md:w-64 md:shrink-0">
              <span className="sr-only">Search products or scan a code</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-smoke" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search or scan code"
                className="h-11 w-full rounded-lg bg-paper pr-3 pl-10 ring-1 ring-ink/10 outline-none transition-shadow duration-150 placeholder:text-smoke focus:ring-2 focus:ring-gold"
              />
            </label>
            <div className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Category">
              {categories.map((c) => (
                <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className="press relative h-11 shrink-0 rounded-lg px-4 text-sm font-semibold">
                  {cat === c && <motion.span layoutId="cat-pill" className="absolute inset-0 rounded-lg bg-ink" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
                  <span className={`relative transition-colors duration-150 ${cat === c ? 'text-paper' : 'text-smoke hover:text-ink'}`}>{c}</span>
                </button>
              ))}
            </div>
            {today && (
              <p className="tabular shrink-0 text-sm text-smoke md:ml-auto md:text-right">
                Today <b className="font-semibold text-ink"><CountUp value={today.revenue} format={money} /></b> · <CountUp value={today.receipts} /> receipt{today.receipts === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {loadError && (
            <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">Couldn't load products. {loadError}</span>
              <button type="button" onClick={load} className="press rounded-md bg-crimson px-3 py-1.5 font-semibold text-paper">
                Try again
              </button>
            </div>
          )}
          {!products && !loadError && <SkeletonGrid />}
          {products && shown.length === 0 && (
            <p className="mt-16 text-center text-smoke">
              {products.length === 0 ? 'No products yet. Add them in Inventory.' : `Nothing matches "${query}".`}
            </p>
          )}

          {/* Keyed on the filter so switching category cross-fades instead of popping. */}
          <div key={cat} className="fade-in">
            {groups.map(([category, ps]) => (
              <section key={category} aria-labelledby={`cat-${category}`} className="mt-6">
                <h2 id={`cat-${category}`} className="font-display text-xl font-extrabold uppercase leading-none">
                  {category} <span className="tabular text-smoke/70">{ps.length}</span>
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {ps.map((p) => (
                    <li key={p.id}>
                      <ProductTile p={p} inCart={qtyIn(p.id)} onAdd={() => add(p)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <aside aria-label="Current sale" className={`bg-ink text-paper lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto ${sheet ? 'sheet-in fixed inset-0 z-30 flex flex-col overflow-y-auto' : 'max-lg:hidden'}`}>
          <Cart
            lines={lines}
            count={count}
            subtotal={subtotal}
            total={total}
            {...{ method, setMethod, tendered, setTendered, gcashRef, setGcashRef, discount, setDiscount, discTooBig, customer, setCustomer, change, busy, error, canCharge, charge, setQty }}
            onClear={() => setCart([])}
            onClose={() => setSheet(false)}
          />
        </aside>
      </div>

      {/* Phones and small tablets: the cart lives in a sheet behind this bar. */}
      <AnimatePresence>
        {count > 0 && !sheet && (
          <motion.button
            type="button"
            onClick={() => setSheet(true)}
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex h-16 items-center justify-between rounded-xl bg-ink px-5 text-paper shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)] lg:hidden"
            initial={{ transform: 'translateY(130%)' }}
            animate={{ transform: 'translateY(0%)' }}
            exit={{ transform: 'translateY(130%)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="size-5 text-gold" aria-hidden="true" /> {count} item{count === 1 ? '' : 's'}
            </span>
            <span className="tabular font-display text-2xl font-black">Review {money(total)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>{receipt && <Receipt sale={receipt} cashier={profile?.full_name} onDone={newSale} />}</AnimatePresence>
    </>
  )
}

function SkeletonGrid() {
  return (
    <div className="mt-6" aria-label="Loading products" role="status">
      <div className="skeleton h-5 w-28 rounded bg-ink/10" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 8 }, (_, k) => (
          <div key={k} className="skeleton h-36 rounded-xl bg-paper ring-1 ring-ink/5" style={{ animationDelay: `${k * 60}ms` }} />
        ))}
      </div>
    </div>
  )
}

function ProductTile({ p, inCart, onAdd }) {
  const s = stockOf(p)
  const soldOut = p.kind === 'good' && inCart >= p.stock_qty
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={soldOut}
      aria-label={`Add ${p.name}, ${money(p.selling_price)}, ${s.label}${inCart ? `, ${inCart} in cart` : ''}`}
      className={`press relative flex h-full min-h-36 w-full flex-col rounded-xl bg-paper p-4 text-left ring-1 transition-[box-shadow,opacity,transform] duration-150 hover:ring-ink/25 disabled:cursor-not-allowed disabled:opacity-50 ${inCart ? 'ring-2 ring-gold hover:ring-gold' : 'ring-ink/8'}`}
    >
      <span className="font-semibold leading-snug text-pretty">{p.name}</span>
      <span className="tabular mt-auto pt-3 font-display text-3xl font-black leading-none">{money(p.selling_price)}</span>
      <span className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span className={`font-semibold ${s.tone}`}>{s.label}</span>
        <span className="text-smoke">{p.code}</span>
      </span>
      <AnimatePresence>
        {inCart > 0 && (
          <motion.span
            aria-hidden="true"
            className="tabular absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-gold text-sm font-bold text-ink shadow-[0_4px_10px_-2px_rgb(25_23_27/0.35)]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.3 }}
          >
            {/* Remounts per count so each tap gets a small bump. */}
            <motion.span key={inCart} initial={{ scale: 1.35 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.25, bounce: 0.4 }}>
              {inCart}
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

const darkField = 'h-11 w-full rounded-lg bg-ink-2 px-3 text-paper ring-1 ring-paper/10 outline-none transition-shadow duration-150 placeholder:text-ash focus:ring-2 focus:ring-gold'
const chip = 'press flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-paper/10 text-ash hover:text-paper'

function Cart({ lines, count, subtotal, total, method, setMethod, tendered, setTendered, gcashRef, setGcashRef, discount, setDiscount, discTooBig, customer, setCustomer, change, busy, error, canCharge, charge, setQty, onClear, onClose }) {
  const [showDiscount, setShowDiscount] = useState(false)
  const [showCustomer, setShowCustomer] = useState(false)
  // Collapse the optional fields again once a sale clears them.
  useEffect(() => {
    if (!lines.length && !discount) setShowDiscount(false)
    if (!lines.length && !customer) setShowCustomer(false)
  }, [lines.length, discount, customer])

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3 short:pt-3 short:pb-1">
        <h2 className="font-display text-2xl font-extrabold uppercase leading-none">
          Current sale {count > 0 && <span className="tabular text-ash">· {count}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <button type="button" onClick={onClear} className="press rounded-lg px-2.5 py-1.5 text-sm font-semibold text-ash hover:text-paper">
              Clear
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Back to products" className="press grid size-10 place-items-center rounded-lg ring-1 ring-paper/10 lg:hidden">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ul className="min-h-36 flex-1 overflow-y-auto px-5 short:min-h-16">
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.li
              key={l.id}
              layout="position"
              initial={{ opacity: 0, transform: 'translateX(16px)' }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex items-center gap-3 border-b border-paper/8 py-3 short:py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{l.name}</p>
                <p className="tabular text-xs text-ash">{money(l.selling_price)} each</p>
              </div>
              <div className="flex items-center rounded-lg bg-ink-2 ring-1 ring-paper/10">
                <button type="button" onClick={() => setQty(l, l.qty - 1)} aria-label={l.qty === 1 ? `Remove ${l.name}` : `One less ${l.name}`} className="press grid size-10 place-items-center text-ash hover:text-paper">
                  {l.qty === 1 ? <X className="size-4" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}
                </button>
                <span className="tabular w-7 text-center font-bold">{l.qty}</span>
                <button
                  type="button"
                  onClick={() => setQty(l, l.qty + 1)}
                  disabled={l.kind === 'good' && l.qty >= l.stock_qty}
                  aria-label={`One more ${l.name}`}
                  className="press grid size-10 place-items-center text-ash hover:text-paper disabled:opacity-30"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
              <span className="tabular w-20 text-right font-semibold">{money(l.qty * l.selling_price)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
        {lines.length === 0 && (
          <li className="grid h-full min-h-40 place-items-center text-center text-ash">
            <div>
              <ShoppingBag className="mx-auto size-10 text-ash/50" aria-hidden="true" />
              <p className="mt-3 font-semibold text-paper">Tap a product to start a sale</p>
              <p className="mt-1 text-sm">Or type or scan its code and press Enter.</p>
            </div>
          </li>
        )}
      </ul>

      <div className="shrink-0 space-y-3.5 border-t border-paper/10 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] short:space-y-2 short:pt-2.5 short:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="tabular space-y-2 text-sm">
          <div className="flex min-h-9 items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {!showDiscount && (
                <button type="button" onClick={() => setShowDiscount(true)} className={chip}>
                  <Tag className="size-3.5" aria-hidden="true" /> Discount
                </button>
              )}
              {!showCustomer && (
                <button type="button" onClick={() => setShowCustomer(true)} className={chip}>
                  <UserRound className="size-3.5" aria-hidden="true" /> Customer
                </button>
              )}
            </div>
            <span className="text-ash">
              Subtotal <span className="text-paper">{money(subtotal)}</span>
            </span>
          </div>
          {showDiscount && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="discount" className="text-ash">
                Discount
              </label>
              <span className="flex items-center gap-1">
                <span className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ash">−₱</span>
                  <input id="discount" inputMode="decimal" autoComplete="off" autoFocus value={discount} onChange={moneyInput(setDiscount)} className={`${darkField} h-9 w-28 pl-8 text-right`} />
                </span>
                <button type="button" onClick={() => (setDiscount(''), setShowDiscount(false))} aria-label="Remove discount" className="press grid size-9 place-items-center text-ash hover:text-paper">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
          {discTooBig && (
            <p role="alert" className="text-xs font-semibold text-[#FF8A9B]">
              Discount can't be more than the subtotal.
            </p>
          )}
          {showCustomer && (
            <div className="flex items-center gap-1">
              <label className="relative flex-1">
                <span className="sr-only">Customer name</span>
                <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ash" aria-hidden="true" />
                <input autoFocus value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" className={`${darkField} h-9 pl-9`} />
              </label>
              <button type="button" onClick={() => (setCustomer(''), setShowCustomer(false))} aria-label="Remove customer" className="press grid size-9 place-items-center text-ash hover:text-paper">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="flex items-end justify-between">
            <span className="font-display text-xl font-extrabold uppercase">Total</span>
            <span className="font-display text-5xl font-black leading-none short:text-4xl">
              <CountUp value={total} format={money} duration={0.25} />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Payment method">
          {METHODS.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={method === value} onClick={() => setMethod(value)} className="press relative h-10 rounded-lg text-[0.8rem] font-semibold ring-1 ring-paper/10">
              {method === value && <motion.span layoutId="pay-pill" className="absolute inset-0 rounded-lg bg-gold" transition={{ type: 'spring', duration: 0.25, bounce: 0.1 }} />}
              <span className={`relative transition-colors duration-150 ${method === value ? 'text-ink' : 'text-ash hover:text-paper'}`}>{label}</span>
            </button>
          ))}
        </div>

        {method === 'cash' && lines.length > 0 && <CashIn total={total} tendered={tendered} setTendered={setTendered} change={change} />}
        {method === 'gcash' && lines.length > 0 && (
          <label className="block">
            <span className="text-sm text-ash">Last 4 digits of the GCash reference no.</span>
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={gcashRef}
              onChange={(e) => setGcashRef(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0000"
              className={`${darkField} tabular mt-1.5 h-14 text-center font-display text-3xl font-black tracking-[0.4em] short:h-12`}
            />
          </label>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/25 px-3 py-2.5 text-sm ring-1 ring-crimson/60">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}

        <button
          type="button"
          onClick={charge}
          disabled={!canCharge}
          className="press flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gold font-display text-2xl short:h-12 font-black uppercase tracking-[0.03em] text-ink transition-[opacity,transform] duration-150 disabled:opacity-35"
        >
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden="true" /> Recording
            </>
          ) : lines.length ? (
            <>Charge {money(total)}</>
          ) : (
            'Charge'
          )}
        </button>
      </div>
    </>
  )
}

function CashIn({ total, tendered, setTendered, change }) {
  const short = change < 0
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative block">
          <span className="sr-only">Cash received</span>
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ash">₱</span>
          <input inputMode="decimal" autoComplete="off" value={tendered} onChange={moneyInput(setTendered)} placeholder={`Cash received`} className={`${darkField} tabular h-14 pl-7 text-lg short:h-12`} />
        </label>
        {/* No count-up here: the figure must be right the instant the cashier reads it. */}
        <div className={`flex h-14 min-w-36 flex-col short:h-12 justify-center rounded-lg px-3.5 text-right transition-colors duration-150 ${short ? 'bg-crimson/25 ring-1 ring-crimson/60' : 'bg-ink-2'}`} aria-live="polite">
          <span className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-ash">{short ? 'Short by' : 'Change'}</span>
          <span className={`tabular font-display text-3xl font-black leading-none ${short ? 'text-paper' : 'text-gold'}`}>{money(Math.abs(change))}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setTendered('')} aria-pressed={tendered === ''} className={`${chip} ${tendered === '' ? 'bg-paper/10 text-paper' : ''}`}>
          Exact {money(total)}
        </button>
        {quickCash(total).map((v) => (
          <button key={v} type="button" onClick={() => setTendered(String(v))} aria-pressed={tendered === String(v)} className={`${chip} tabular ${tendered === String(v) ? 'bg-paper/10 text-paper' : ''}`}>
            {money(v)}
          </button>
        ))}
      </div>
    </div>
  )
}

// One heartbeat, borrowed from the splash: lub-dub, then rest.
const lubDub = (peak, second, rest) => [
  { to: peak, duration: 110, ease: 'out(3)' },
  { to: rest + (peak - rest) * 0.35, duration: 160, ease: 'in(2)' },
  { to: second, duration: 110, ease: 'out(3)' },
  { to: rest, duration: 520, ease: 'out(2)' },
]

function Receipt({ sale, cashier, onDone }) {
  const cash = sale.payment_method === 'cash'
  const root = useRef(null)
  const withReceipt = useCallback(() => {
    printReceipt(saleReceipt(sale, { cashier, method: METHOD_LABEL[sale.payment_method] }))
    onDone()
  }, [sale, cashier, onDone])

  // Optional: print straight away (off by default, see config/receipt.js).
  useEffect(() => {
    if (RECEIPT.autoPrint) withReceipt()
  }, []) // once per sale

  // Enter = print receipt, Escape = no receipt.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      e.key === 'Enter' ? withReceipt() : onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone, withReceipt])

  // The register's one authored moment: the ECG trace runs across and the amount beats once.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scope = createScope({ root }).add(() => {
      animate(svg.createDrawable('.ecg'), { draw: [{ from: '0 0', to: '0 1', duration: 520, ease: 'out(2)' }, { to: '1 1', duration: 380, ease: 'in(2)' }], delay: 120 })
      animate('.glow', { opacity: lubDub(1, 0.7, 0.25), scale: lubDub(1.15, 1.07, 1), delay: 380 })
      animate('.amount', { scale: lubDub(1.06, 1.03, 1), delay: 380 })
    })
    return () => scope.revert()
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => e.target === e.currentTarget && onDone()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
    >
      <motion.div
        ref={root}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-paper shadow-[0_24px_64px_-12px_rgb(0_0_0/0.6)]"
        initial={{ opacity: 0, transform: 'translateY(16px) scale(0.97)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px) scale(0.98)', transition: { duration: 0.15 } }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
      >
        <div className="relative overflow-hidden bg-ink px-6 pt-6 pb-4 text-paper short:pt-4 short:pb-2">
          <div className="glow pointer-events-none absolute top-1/2 left-0 size-72 -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgb(186_0_33/0.55)_0%,rgb(254_190_16/0.16)_40%,transparent_68%)] opacity-25" />
          <p id="receipt-title" className="relative flex items-center gap-2 text-sm font-bold text-active">
            <CircleCheck className="size-4" aria-hidden="true" /> Sale recorded{sale.sale_no ? ` · receipt #${String(sale.sale_no).padStart(5, '0')}` : ''}
          </p>
          <p className="relative mt-4 font-display text-xl font-extrabold uppercase text-ash short:mt-2">{cash ? 'Change to give' : `Paid by ${METHOD_LABEL[sale.payment_method]}${sale.payment_ref ? ` · ref …${sale.payment_ref}` : ''}`}</p>
          <p className="amount tabular relative origin-left font-display text-7xl font-black leading-none text-gold short:text-6xl">{money(cash ? (sale.change_due ?? 0) : sale.total)}</p>
          <svg viewBox="0 0 400 28" preserveAspectRatio="none" className="relative mt-4 h-6 w-full overflow-visible" aria-hidden="true">
            <path className="ecg" d="M0 16 H150 l7 -4 l7 4 H178 l6 -14 l8 24 l6 -10 H232 l8 -5 l8 5 H400" fill="none" stroke="var(--color-crimson)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="px-6 pt-4 pb-6 short:pt-3 short:pb-4">
          <ul className="tabular space-y-1.5 text-sm">
            {sale.sale_items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span>
                  <span className="text-smoke">{i.qty} ×</span> {i.product_name}
                </span>
                <span>{money(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="tabular mt-4 space-y-1 border-t border-ink/10 pt-3 text-sm">
            {Number(sale.discount) > 0 && (
              <div className="flex justify-between text-smoke">
                <dt>Discount</dt>
                <dd>−{money(sale.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd>{money(sale.total)}</dd>
            </div>
            {cash && (
              <div className="flex justify-between text-smoke">
                <dt>Cash received</dt>
                <dd>{money(sale.amount_tendered ?? sale.total)}</dd>
              </div>
            )}
            {sale.customer_name && (
              <div className="flex justify-between text-smoke">
                <dt>Customer</dt>
                <dd>{sale.customer_name}</dd>
              </div>
            )}
          </dl>
          <button type="button" autoFocus onClick={withReceipt} className="press mt-6 h-12 w-full rounded-xl bg-ink font-display short:mt-4 text-xl font-black uppercase tracking-[0.04em] text-paper">
            Print receipt
          </button>
          <button type="button" onClick={onDone} className="press mt-2 h-11 w-full rounded-xl font-semibold ring-1 ring-ink/15">
            No receipt
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
