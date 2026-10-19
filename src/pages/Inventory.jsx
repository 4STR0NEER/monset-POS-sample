import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, CircleX, ClipboardCheck, EyeOff, History, Loader2, PackageMinus, PackagePlus, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { money, moneyInput } from '../lib/util.js'
import { EASE_OUT, Segmented, Sheet, fmtDateTime, stockOf } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'

const field = 'h-11 w-full rounded-lg bg-paper px-3 ring-1 ring-ink/15 outline-none transition-shadow duration-150 placeholder:text-smoke/70 focus:ring-2 focus:ring-gold'
const label = 'block text-sm font-semibold'
const intInput = (set) => (e) => /^\d*$/.test(e.target.value) && set(e.target.value)

const STATUS_BADGE = {
  low: ['bg-gold/20 text-[#7A5A00]', CircleAlert, 'Low'],
  out: ['bg-crimson/10 text-crimson', CircleX, 'Out'],
  ok: ['bg-active/10 text-active', CircleCheck, 'OK'],
}

export default function Inventory() {
  const [products, setProducts] = useState(null)
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const [view, setView] = useState('all') // all | restock | hidden
  const [open, setOpen] = useState(null) // { id, tab } or { create: true }
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').is('deleted_at', null).order('category').order('name')
    if (error) setError(error.message)
    else {
      setError(null)
      setProducts(data)
    }
  }, [])
  useEffect(() => {
    load()
    supabase
      .from('profiles')
      .select('id, full_name')
      .then(({ data }) => setPeople(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))))
  }, [load])

  const all = products ?? []
  const categories = useMemo(() => [...new Set(all.map((p) => p.category))], [all])
  const goods = all.filter((p) => p.is_active && p.kind === 'good')
  const summary = {
    low: goods.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.reorder_level).length,
    out: goods.filter((p) => p.stock_qty <= 0).length,
    atCost: goods.reduce((s, p) => s + Math.max(p.stock_qty, 0) * p.unit_cost, 0),
    atPrice: goods.reduce((s, p) => s + Math.max(p.stock_qty, 0) * p.selling_price, 0),
  }
  const q = query.trim().toLowerCase()
  const rows = all.filter(
    (p) =>
      (view === 'hidden' ? !p.is_active : p.is_active) &&
      (view !== 'restock' || (p.kind === 'good' && p.stock_qty <= p.reorder_level)) &&
      (cat === 'All' || p.category === cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)),
  )
  const current = open?.id ? all.find((p) => p.id === open.id) : null

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl font-black uppercase leading-none">Inventory</h1>
          <p className="mt-1 text-smoke">Stock, prices and product details. Every change is logged with who made it.</p>
        </div>
        <button type="button" onClick={() => setOpen({ create: true })} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> Add product
        </button>
      </header>

      <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 lg:grid-cols-4">
        {[
          ['Products on sale', all.filter((p) => p.is_active).length, null, null],
          ['Need restocking', summary.low + summary.out, `${summary.out} out · ${summary.low} low`, summary.low + summary.out ? 'text-[#7A5A00]' : null],
          ['Stock value at cost', money(summary.atCost), 'What the shelf cost you', null],
          ['Stock value at price', money(summary.atPrice), `${money(summary.atPrice - summary.atCost)} profit if all sells`, null],
        ].map(([k, v, note, tone], i) => (
          <div key={k} className={`border-ink/8 p-5 ${i % 2 === 0 ? 'border-r' : ''} max-lg:[&:nth-child(-n+2)]:border-b lg:border-r lg:last:border-r-0`}>
            <dt className="text-sm font-semibold text-smoke">{k}</dt>
            <dd className={`tabular mt-2 font-display text-3xl font-black leading-none sm:text-4xl ${tone ?? ''}`}>{products ? v : '–'}</dd>
            {note && <dd className="tabular mt-1.5 text-xs text-smoke">{products ? note : ''}</dd>}
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-64 lg:shrink-0">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-smoke" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or code" className={`${field} pl-10`} />
        </label>
        <div className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="group" aria-label="Category">
          {['All', ...categories].map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className="press relative h-11 shrink-0 rounded-lg px-4 text-sm font-semibold">
              {cat === c && <motion.span layoutId="inv-cat" className="absolute inset-0 rounded-lg bg-ink" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
              <span className={`relative transition-colors duration-150 ${cat === c ? 'text-paper' : 'text-smoke hover:text-ink'}`}>{c}</span>
            </button>
          ))}
        </div>
        <Segmented
          id="inv-view"
          className="lg:ml-auto lg:w-auto"
          value={view}
          onChange={setView}
          options={[
            ['all', 'On sale'],
            ['restock', `Restock${summary.low + summary.out ? ` · ${summary.low + summary.out}` : ''}`],
            ['hidden', 'Hidden'],
          ]}
        />
      </div>

      <AnimatePresence>
        {flash && (
          <motion.p
            role="status"
            className="mt-6 flex items-center gap-2 rounded-lg bg-active/12 px-4 py-3 text-sm font-semibold text-[#0B6B35]"
            initial={{ opacity: 0, transform: 'translateY(-6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{flash}</span>
            <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="press grid size-7 place-items-center rounded-md hover:bg-active/15">
              <X className="size-4" aria-hidden="true" />
            </button>
          </motion.p>
        )}
      </AnimatePresence>

      {error && (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Couldn't load inventory. {error}</span>
          <button type="button" onClick={load} className="press rounded-md bg-crimson px-3 py-1.5 font-semibold text-paper">
            Try again
          </button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {!products && !error && (
          <div role="status" aria-label="Loading inventory" className="divide-y divide-ink/5">
            {Array.from({ length: 6 }, (_, k) => (
              <div key={k} className="skeleton h-16" style={{ animationDelay: `${k * 60}ms` }} />
            ))}
          </div>
        )}
        {products && rows.length === 0 && (
          <p className="px-5 py-14 text-center text-smoke">
            {view === 'restock' ? 'Nothing needs restocking. Shelves are full.' : view === 'hidden' ? 'No hidden products.' : all.length ? 'No products match.' : 'No products yet. Add your first one.'}
          </p>
        )}
        {rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Product</th>
                <th scope="col" className="px-3 py-3 font-bold">Stock</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Cost</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Price</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Margin</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((p) => (
                <Row key={p.id} p={p} onOpen={(tab) => setOpen({ id: p.id, tab })} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {open && (open.create || current) && (
          <Drawer
            key="drawer"
            product={current}
            tab={open.tab}
            categories={categories}
            people={people}
            onClose={() => setOpen(null)}
            onSaved={async (id, tab) => {
              await load()
              if (id) setOpen({ id, tab })
            }}
            onDeleted={(msg) => {
              setOpen(null)
              setFlash(msg)
              load()
            }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

function Row({ p, onOpen }) {
  const s = stockOf(p)
  const [badgeTone, BadgeIcon, badgeText] = STATUS_BADGE[s.key] ?? []
  const good = p.kind === 'good'
  return (
    <tr className="group transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3">
      <td className="px-5 py-3 max-md:col-span-2 max-md:p-0">
        <button type="button" onClick={() => onOpen('stock')} className="text-left">
          <span className="font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{p.name}</span>
          <span className="mt-0.5 block text-xs text-smoke">
            {p.code} · {p.category}
            {!p.is_active && (
              <span className="ml-2 inline-flex items-center gap-1 font-semibold">
                <EyeOff className="size-3" aria-hidden="true" /> Hidden
              </span>
            )}
          </span>
        </button>
      </td>
      <td className="px-3 py-3 max-md:p-0 max-md:pt-2">
        {good ? (
          <span className="flex items-center gap-2">
            <span className="tabular w-10 font-display text-2xl font-black leading-none">{p.stock_qty}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${badgeTone}`}>
              <BadgeIcon className="size-3" aria-hidden="true" />
              {badgeText}
            </span>
            <span className="text-xs text-smoke max-lg:hidden">reorder at {p.reorder_level}</span>
          </span>
        ) : (
          <span className="text-smoke">Service</span>
        )}
      </td>
      <td className="tabular px-3 py-3 text-right text-smoke max-md:hidden">{money(p.unit_cost)}</td>
      <td className="tabular px-3 py-3 text-right font-semibold max-md:p-0 max-md:pt-2 max-md:text-left">
        {money(p.selling_price)}
        <span className="font-normal text-smoke md:hidden"> · cost {money(p.unit_cost)}</span>
      </td>
      <td className="tabular px-3 py-3 text-right max-md:hidden">{p.add_on_pct == null ? '–' : `${Math.round(p.add_on_pct)}%`}</td>
      <td className="px-5 py-3 max-md:col-span-2 max-md:p-0 max-md:pt-3">
        <span className="flex justify-end gap-1.5 max-md:justify-start">
          {good && (
            <>
              <IconBtn onClick={() => onOpen('stock:receive')} Icon={PackagePlus} label="Receive" />
              <IconBtn onClick={() => onOpen('stock:count')} Icon={ClipboardCheck} label="Count" />
            </>
          )}
          <IconBtn onClick={() => onOpen('details')} Icon={Pencil} label="Edit" />
        </span>
      </td>
    </tr>
  )
}

function IconBtn({ Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="press flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 transition-colors duration-150 hover:bg-ink hover:text-paper hover:ring-ink">
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  )
}

function Drawer({ product, tab: initial = 'stock', categories, people, onClose, onSaved, onDeleted }) {
  const create = !product
  const [tab, setTab] = useState(create ? 'details' : initial.split(':')[0])
  const [notice, setNotice] = useState(null)

  const done = (msg, id, nextTab) => {
    setNotice(msg)
    onSaved(id, nextTab)
    if (nextTab) setTab(nextTab)
  }
  const tabs = product?.kind === 'good' ? [['stock', 'Stock', SlidersHorizontal], ['details', 'Details', Pencil], ['history', 'History', History]] : [['details', 'Details', Pencil], ['history', 'History', History]]

  return (
    <Sheet
      title={create ? 'New product' : product.name}
      subtitle={!create && `${product.code} · ${product.category} · ${money(product.selling_price)}`}
      onClose={onClose}
      header={!create && <Segmented id="drawer-tab" dark className="mt-4" value={tab} onChange={(t) => (setTab(t), setNotice(null))} options={tabs} />}
    >
      <AnimatePresence>
        {notice && (
          <motion.p
            role="status"
            className="mb-4 flex items-start gap-2 rounded-lg bg-active/12 px-3 py-2.5 text-sm font-semibold text-[#0B6B35]"
            initial={{ opacity: 0, transform: 'translateY(-6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {notice}
          </motion.p>
        )}
      </AnimatePresence>
      {tab === 'stock' && product && <StockTab key={product.stock_qty} product={product} initial={initial.split(':')[1]} onDone={done} />}
      {tab === 'details' && <DetailsTab product={product} categories={categories} onDone={done} onDeleted={onDeleted} />}
      {tab === 'history' && product && <HistoryTab product={product} people={people} />}
    </Sheet>
  )
}

function Problem({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/10 px-3 py-2.5 text-sm font-semibold text-crimson">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </p>
  )
}

function Submit({ busy, children, disabled }) {
  return (
    <button type="submit" disabled={busy || disabled} className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink font-display text-xl font-black uppercase tracking-[0.03em] text-paper disabled:opacity-40">
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`

function StockTab({ product, initial, onDone }) {
  const [mode, setMode] = useState(initial ?? 'receive')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(String(product.unit_cost))
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const s = stockOf(product)
  const n = qty === '' ? null : Number(qty)

  const preview =
    n == null
      ? null
      : mode === 'receive'
        ? product.stock_qty + n
        : mode === 'count'
          ? n
          : product.stock_qty - n

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (n == null || (mode !== 'count' && n <= 0)) return setErr('Enter how many.')
    if (mode === 'writeoff' && n > product.stock_qty) return setErr(`Only ${product.stock_qty} in stock.`)
    if (mode === 'writeoff' && !note.trim()) return setErr('Say why, e.g. expired or damaged.')
    setBusy(true)
    let res
    if (mode === 'count') res = await supabase.rpc('set_stock_count', { p_product_id: product.id, p_counted: n, p_note: note.trim() || null })
    else
      res = await supabase.from('stock_movements').insert({
        product_id: product.id,
        movement_type: mode === 'receive' ? 'purchase' : 'spoilage',
        qty: mode === 'receive' ? n : -n,
        unit_cost: mode === 'receive' && cost !== '' ? Number(cost) : null,
        supplier: mode === 'receive' ? supplier.trim() || null : null,
        note: note.trim() || null,
      })
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    onDone(
      mode === 'receive'
        ? `Received ${plural(n, 'unit')}. Stock is now ${product.stock_qty + n}.`
        : mode === 'writeoff'
          ? `Wrote off ${plural(n, 'unit')}. Stock is now ${product.stock_qty - n}.`
          : res.data === 0
            ? `Count matches: ${n} on the shelf.`
            : `Count saved: ${res.data > 0 ? '+' : ''}${res.data} adjustment, stock is now ${n}.`,
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-end justify-between rounded-xl bg-paper p-4 ring-1 ring-ink/5">
        <div>
          <p className="text-sm font-semibold text-smoke">On the shelf</p>
          <p className="tabular font-display text-6xl font-black leading-none">{product.stock_qty}</p>
          <p className={`mt-1 text-sm font-semibold ${s.tone}`}>
            {s.label} · reorder at {product.reorder_level}
          </p>
        </div>
        <AnimatePresence>
          {preview != null && preview !== product.stock_qty && (
            <motion.div
              className="text-right"
              initial={{ opacity: 0, transform: 'translateX(8px)' }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
            >
              <p className="text-sm font-semibold text-smoke">After this</p>
              <p className={`tabular font-display text-6xl font-black leading-none ${preview < 0 ? 'text-crimson' : 'text-[#A87800]'}`}>{preview}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Segmented
        id="stock-mode"
        value={mode}
        onChange={(m) => (setMode(m), setErr(null), setQty(''))}
        options={[
          ['receive', 'Receive', PackagePlus],
          ['count', 'Count', ClipboardCheck],
          ['writeoff', 'Write off', PackageMinus],
        ]}
      />
      <p className="text-sm text-smoke">
        {mode === 'receive' && 'A delivery or restock arrived. Adds to the shelf count.'}
        {mode === 'count' && 'You counted the shelf. Enter the real number and the difference is recorded.'}
        {mode === 'writeoff' && 'Expired, damaged or used up. Removes units with a reason.'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          {mode === 'receive' ? 'Units received' : mode === 'count' ? 'Units counted' : 'Units to write off'}
          <input inputMode="numeric" autoFocus value={qty} onChange={intInput(setQty)} className={`${field} tabular mt-1.5 text-lg`} />
        </label>
        {mode === 'receive' && (
          <label className={label}>
            Cost per unit
            <span className="relative mt-1.5 block">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
              <input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} className={`${field} tabular pl-7 text-lg`} />
            </span>
          </label>
        )}
      </div>
      {mode === 'receive' && (
        <label className={label}>
          Supplier <span className="font-normal text-smoke">(optional)</span>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${field} mt-1.5`} />
        </label>
      )}
      <label className={label}>
        {mode === 'writeoff' ? 'Reason' : 'Note'} {mode !== 'writeoff' && <span className="font-normal text-smoke">(optional)</span>}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'writeoff' ? 'Expired, damaged, staff use…' : ''} className={`${field} mt-1.5`} />
      </label>
      {mode === 'receive' && cost !== '' && Number(cost) !== Number(product.unit_cost) && (
        <p className="text-sm text-smoke">
          Unit cost will update from {money(product.unit_cost)} to {money(Number(cost))}.
        </p>
      )}
      {err && <Problem>{err}</Problem>}
      <Submit busy={busy}>{mode === 'receive' ? 'Add to stock' : mode === 'count' ? 'Save count' : 'Write off'}</Submit>
    </form>
  )
}

const BLANK = { name: '', code: '', category: '', kind: 'good', selling_price: '', unit_cost: '', reorder_level: '5', is_active: true }

function DetailsTab({ product, categories, onDone, onDeleted }) {
  const create = !product
  const { isAdmin } = useAuth()
  const [f, setF] = useState(() => (create ? BLANK : { ...product, selling_price: String(product.selling_price), unit_cost: String(product.unit_cost), reorder_level: String(product.reorder_level) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const price = Number(f.selling_price) || 0
  const cost = Number(f.unit_cost) || 0

  const clean = () => ({
    name: f.name.trim(),
    code: f.code.trim().toUpperCase(),
    category: f.category.trim() || 'Other',
    kind: f.kind,
    selling_price: price,
    unit_cost: cost,
    reorder_level: Number(f.reorder_level) || 0,
    is_active: f.is_active,
  })
  const changes = create ? clean() : Object.fromEntries(Object.entries(clean()).filter(([k, v]) => v !== (typeof product[k] === 'number' ? Number(product[k]) : product[k])))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    const c = clean()
    if (!c.name || !c.code) return setErr('Name and code are required.')
    if (f.selling_price === '') return setErr('Enter a selling price.')
    if (!create && !Object.keys(changes).length) return setErr('Nothing changed.')
    setBusy(true)
    const res = create ? await supabase.from('products').insert(c).select('id').single() : await supabase.from('products').update(changes).eq('id', product.id)
    setBusy(false)
    if (res.error) return setErr(res.error.code === '23505' ? `Code ${c.code} is already used by another product.` : res.error.message)
    if (create) onDone(c.kind === 'good' ? `${c.name} added. Receive its opening stock below.` : `${c.name} added. It's on the register now.`, res.data.id, c.kind === 'good' ? 'stock' : 'details')
    else onDone(`Saved ${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? '' : 's'}.`)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={label}>
        Name
        <input autoFocus={create} value={f.name} onChange={(e) => set('name')(e.target.value)} className={`${field} mt-1.5`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Code
          <input value={f.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} placeholder="P25" className={`${field} mt-1.5 uppercase`} />
        </label>
        <label className={label}>
          Category
          <input list="categories" value={f.category} onChange={(e) => set('category')(e.target.value)} placeholder="Drinks" className={`${field} mt-1.5`} />
          <datalist id="categories">
            {[...new Set([...categories, 'Membership'])].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>
      <div>
        <p className={label}>Type</p>
        <Segmented
          id="kind"
          className="mt-1.5"
          value={f.kind}
          onChange={set('kind')}
          options={[
            ['good', 'Item with stock'],
            ['service', 'Service, no stock'],
          ]}
        />
        {f.category.trim().toLowerCase() === 'membership' && f.kind === 'good' && <p className="mt-1.5 text-sm text-[#7A5A00]">Memberships are usually a service, so they never run out.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Selling price
          <span className="relative mt-1.5 block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
            <input inputMode="decimal" value={f.selling_price} onChange={moneyInput(set('selling_price'))} className={`${field} tabular pl-7 text-lg`} />
          </span>
        </label>
        <label className={label}>
          Cost per unit
          <span className="relative mt-1.5 block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-smoke">₱</span>
            <input inputMode="decimal" value={f.unit_cost} onChange={moneyInput(set('unit_cost'))} className={`${field} tabular pl-7 text-lg`} />
          </span>
        </label>
      </div>
      <p className="tabular -mt-1 text-sm text-smoke">
        {price > 0 ? (
          <>
            Profit per sale <b className={price - cost < 0 ? 'text-crimson' : 'text-ink'}>{money(price - cost)}</b>
            {cost > 0 && ` · ${Math.round(((price - cost) / cost) * 100)}% on cost`}
          </>
        ) : (
          'Enter a price to see the profit per sale.'
        )}
      </p>
      {f.kind === 'good' && (
        <label className={label}>
          Reorder when stock is at or below
          <input inputMode="numeric" value={f.reorder_level} onChange={intInput(set('reorder_level'))} className={`${field} tabular mt-1.5 w-32`} />
        </label>
      )}
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-paper p-4 ring-1 ring-ink/5">
        <span>
          <span className="block font-semibold">Show on the register</span>
          <span className="text-sm text-smoke">Turn off to take it off sale for now, without deleting it.</span>
        </span>
        <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active')(e.target.checked)} className="size-5 shrink-0 accent-[#19171B]" />
      </label>
      {!create && changes.selling_price !== undefined && (
        <p className="text-sm text-smoke">Past receipts keep the price they were sold at. Only new sales use {money(price)}.</p>
      )}
      {err && <Problem>{err}</Problem>}
      <Submit busy={busy} disabled={!create && !Object.keys(changes).length}>
        {create ? 'Add product' : 'Save changes'}
      </Submit>
      {!create && isAdmin && <DeleteProduct product={product} onDeleted={onDeleted} />}
    </form>
  )
}

// Admin only. Two taps on purpose: deleting can't be undone.
function DeleteProduct({ product, onDeleted }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const del = async () => {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('delete_product', { p_product_id: product.id })
    setBusy(false)
    if (error) return setErr(error.message)
    onDeleted(data === 'archived' ? `${product.name} deleted. It stays on its old receipts and in reports.` : `${product.name} deleted.`)
  }
  return (
    <div className="mt-2 border-t border-ink/10 pt-5">
      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)} className="press flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-crimson ring-1 ring-crimson/30 transition-colors duration-150 hover:bg-crimson/8">
          <Trash2 className="size-4" aria-hidden="true" /> Delete product
        </button>
      ) : (
        <div role="alertdialog" aria-labelledby="del-title" className="rounded-xl bg-crimson/8 p-4 ring-1 ring-crimson/25">
          <p id="del-title" className="font-semibold">Delete {product.name}?</p>
          <p className="mt-1 text-sm text-smoke">
            It disappears from Inventory and the register. This can't be undone. If it was ever sold, its old receipts and reports keep it. Only want it off sale for a while? Turn off "Show on the register" instead.
          </p>
          {err && (
            <div className="mt-3">
              <Problem>{err}</Problem>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={del} disabled={busy} className="press flex h-11 items-center gap-2 rounded-lg bg-crimson px-4 font-semibold text-paper disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />} Delete for good
            </button>
            <button type="button" onClick={() => (setConfirm(false), setErr(null))} autoFocus className="press h-11 rounded-lg px-4 font-semibold text-smoke ring-1 ring-ink/15 hover:text-ink">
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const FIELD_LABEL = { name: 'Name', code: 'Code', category: 'Category', kind: 'Type', selling_price: 'Price', unit_cost: 'Cost', reorder_level: 'Reorder level', is_active: 'Register' }
const fmtVal = (field, v) =>
  v == null ? '–' : field === 'selling_price' || field === 'unit_cost' ? money(v) : field === 'is_active' ? (v === 'true' ? 'shown' : 'hidden') : field === 'kind' ? (v === 'good' ? 'item' : 'service') : v

const MOVE = {
  purchase: [PackagePlus, 'text-active', (m) => `+${m.qty} received${m.supplier ? ` from ${m.supplier}` : ''}${m.unit_cost != null ? ` at ${money(m.unit_cost)}` : ''}`],
  sale: [null, 'text-smoke', (m) => `${-m.qty} sold`],
  void: [null, 'text-smoke', (m) => `+${m.qty} returned (sale voided)`],
  spoilage: [PackageMinus, 'text-crimson', (m) => `${-m.qty} written off`],
  adjustment: [ClipboardCheck, 'text-[#7A5A00]', (m) => `${m.qty > 0 ? '+' : ''}${m.qty} from stock count`],
}

function HistoryTab({ product, people }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    Promise.all([
      supabase.from('stock_movements').select('id, movement_type, qty, unit_cost, supplier, note, created_by, occurred_at').eq('product_id', product.id).order('occurred_at', { ascending: false }).limit(100),
      supabase.from('product_changes').select('id, field, old_value, new_value, changed_by, changed_at').eq('product_id', product.id).order('changed_at', { ascending: false }).limit(100),
    ]).then(([m, c]) => {
      if (m.error || c.error) return setErr((m.error ?? c.error).message)
      setItems(
        [
          ...m.data.map((x) => ({ key: 'm' + x.id, at: x.occurred_at, who: x.created_by, move: x })),
          ...c.data.map((x) => ({ key: 'c' + x.id, at: x.changed_at, who: x.changed_by, change: x })),
        ].sort((a, b) => new Date(b.at) - new Date(a.at)),
      )
    })
  }, [product.id, product.stock_qty, product.updated_at])

  if (err) return <Problem>{err}</Problem>
  if (!items) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-smoke" aria-label="Loading history" />
  if (!items.length) return <p className="mt-10 text-center text-smoke">No history yet.</p>
  return (
    <ol className="space-y-1">
      {items.map((it) => {
        const [Icon, tone, text] = it.move ? MOVE[it.move.movement_type] : [Pencil, 'text-smoke']
        return (
          <li key={it.key} className="flex gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-paper">
            <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-paper ring-1 ring-ink/8 ${tone}`}>{Icon ? <Icon className="size-3.5" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" />}</span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {it.move
                  ? text(it.move)
                  : it.change.field === 'created'
                    ? 'Product added'
                    : `${FIELD_LABEL[it.change.field] ?? it.change.field}: ${fmtVal(it.change.field, it.change.old_value)} → ${fmtVal(it.change.field, it.change.new_value)}`}
              </p>
              {it.move?.note && <p className="text-smoke">{it.move.note}</p>}
              <p className="text-xs text-smoke">
                {fmtDateTime(it.at)} · {it.who ? (people[it.who] ?? 'Someone') : 'System'}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
