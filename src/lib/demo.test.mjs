// npm run test:demo — builds the demo database (schema, patches, dummy data) in memory and
// checks the Supabase stand-in in supabase.js answers the way the pages expect.
// Node can't run db.js (IndexedDB, Vite's import.meta.glob), so a loader hook swaps in this
// file, imported again as "?db", which exports the same as/root over an in-memory PGlite.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { register } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import { install } from './seed.js'

let db
const ready = () =>
  (db ??= (async () => {
    const dir = new URL('../../supabase/', import.meta.url)
    const files = ['schema.sql', ...readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()]
    const pg = new PGlite()
    await install(pg, files.map((f) => readFileSync(new URL(f, dir), 'utf8')))
    return pg
  })())
export async function as(uid, fn) {
  return (await ready()).transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
    return fn(tx)
  })
}
export const root = async (q, params) => (await (await ready()).query(q, params)).rows

if (!import.meta.url.endsWith('?db')) {
  const self = JSON.stringify(import.meta.url + '?db')
  register(`data:text/javascript,export const resolve = (s, c, next) => s === './db.js' ? { url: ${encodeURIComponent(self)}, shortCircuit: true } : next(s, c)`)
  const store = new Map()
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  const { supabase, admin } = await import('./supabase.js')
  const { handleStaff } = await import('./staff.js')
  const { DEMO_PASSWORD } = await import('./seed.js')
  let n = 0
  const ok = (m) => console.log(`  ✓ ${++n} ${m}`)
  const t0 = Date.now()
  const login = async (email) => assert.equal((await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error, null)

  assert.match((await supabase.auth.signInWithPassword({ email: 'admin@demo.test', password: 'nope' })).error.message, /Invalid/)
  await login('admin@demo.test')
  ok(`seeded in ${Date.now() - t0} ms; wrong password refused, admin signs in`)

  const { data: me } = await supabase.from('profiles').select('full_name, role').eq('id', (await supabase.auth.getSession()).data.session.user.id).maybeSingle()
  assert.deepEqual(me, { full_name: 'Alex Morgan', role: 'admin' }); ok('maybeSingle returns the profile object')

  const { data: products } = await supabase.from('products').select('id, code, name, kind, selling_price, stock_qty').eq('is_active', true).order('category').order('name')
  assert.ok(products.length >= 16 && typeof products[0].selling_price === 'number'); ok(`${products.length} products, numbers come back as numbers`)
  assert.equal(products.find((p) => p.code === 'P10').stock_qty, 3); ok('low-stock shelf count applied')

  const sales = await supabase.from('sales').select('id, sale_no, total, status, sale_items(product_name, qty)', { count: 'exact' }).order('sold_at', { ascending: false }).range(0, 49)
  assert.equal(sales.error, null); assert.equal(sales.data.length, 50); assert.ok(sales.count > 500 && Array.isArray(sales.data[0].sale_items))
  ok(`sales page: 50 of ${sales.count} with line items embedded`)

  const { data: exp } = await supabase.from('expenses').select('description, amount, expense_categories(name)').eq('status', 'recorded').order('expense_date')
  assert.ok(exp.length > 10 && typeof exp[0].expense_categories.name === 'string'); ok(`${exp.length} expenses, category embedded as an object`)

  const { data: runs } = await supabase.from('payroll_runs').select('*, payroll_items(gross_pay, net_pay)').eq('status', 'finalized')
  assert.equal(runs.length, 6); assert.ok(runs.every((r) => r.payroll_items.length === 3 && r.payroll_items[0].net_pay > 0)); ok('6 finalized pay runs, 3 payslips each')

  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const rep = await supabase.rpc('sales_report', { p_from: from, p_to: to })
  assert.equal(rep.error, null); assert.ok(rep.data.totals.revenue > 0 && rep.data.daily.length === 31); ok(`sales_report: ₱${rep.data.totals.revenue} over 31 days`)
  const list = await supabase.rpc('staff_list')
  assert.equal(list.data.length, 4); assert.equal(list.data[0].email, 'admin@demo.test'); ok('staff_list (set-returning) gives rows')
  assert.match((await supabase.rpc('no_such_fn')).error.message, /missing an update/); ok('unknown function explained')

  const water = products.find((p) => p.code === 'P23')
  const sale = await supabase.rpc('record_sale', { p_items: [{ product_id: water.id, qty: 2 }], p_payment_method: 'cash', p_discount: 0, p_amount_tendered: 50, p_customer_name: null, p_client_ref: crypto.randomUUID(), p_payment_ref: null })
  assert.match(sale.data, /^[0-9a-f-]{36}$/)
  const { data: rcpt } = await supabase.from('sales').select('total, change_due, sale_items(product_name, qty)').eq('id', sale.data).single()
  assert.deepEqual([rcpt.total, rcpt.change_due, rcpt.sale_items[0].qty], [40, 10, 2]); ok('record_sale + read-back: ₱40, ₱10 change')
  assert.equal((await supabase.rpc('void_sale', { p_sale_id: sale.data, p_reason: 'test' })).data, null); ok('void-returning function gives null')

  const ins = await supabase.from('products').insert({ code: 'T1', name: 'Test item', category: 'Other', selling_price: 10 }).select('id').single()
  assert.equal(ins.error, null)
  assert.equal((await supabase.from('products').update({ selling_price: 12 }).eq('id', ins.data.id)).error, null)
  assert.equal((await supabase.from('products').select('selling_price').eq('id', ins.data.id).single()).data.selling_price, 12)
  assert.equal((await supabase.rpc('delete_product', { p_product_id: ins.data.id })).data, 'deleted'); ok('insert…select().single(), update, delete_product')

  const [run] = runs
  const items = (await supabase.from('payroll_items').select('*').eq('run_id', run.id)).data
  assert.match((await supabase.from('payroll_items').upsert(items.map((i) => ({ ...i, net_pay: 1, junk: undefined })))).error?.message ?? '', /finalized|locked|permission|row-level/i); ok('finalized payslips stay locked')
  const draft = (await supabase.from('payroll_runs').insert({ pay_frequency: 'semi_monthly', period_start: to, period_end: to, pay_date: to }).select('id').single()).data
  assert.equal((await supabase.from('payroll_items').insert(items.map(({ id, ...i }) => ({ ...i, run_id: draft.id })))).error, null)
  const drafts = (await supabase.from('payroll_items').select('*').eq('run_id', draft.id)).data
  assert.equal((await supabase.from('payroll_items').upsert(drafts.map((i) => ({ ...i, net_pay: 1 })))).error, null)
  assert.ok((await supabase.from('payroll_items').select('net_pay').eq('run_id', draft.id)).data.every((i) => i.net_pay === 1))
  assert.equal((await supabase.from('payroll_runs').delete().eq('id', draft.id)).error, null); ok('draft run: insert items, upsert edits, delete')

  const up = await supabase.storage.from('receipts').upload('2026-01/x.txt', new Blob(['hello'], { type: 'text/plain' }), { contentType: 'text/plain' })
  assert.equal(up.error, null)
  const url = (await supabase.storage.from('receipts').createSignedUrl('2026-01/x.txt', 300)).data.signedUrl
  assert.equal(await (await fetch(url)).text(), 'hello'); ok('receipt upload and view')

  const made = await handleStaff(admin, (await supabase.auth.getSession()).data.session.access_token, { action: 'create', email: 'new@demo.test', full_name: 'New Person', role: 'staff', password: 'longenough' })
  assert.equal(made.status, 200)
  assert.equal((await supabase.auth.signInWithPassword({ email: 'new@demo.test', password: 'longenough' })).error, null); ok('admin adds a login, it signs in')

  await login('sam@demo.test')
  assert.match((await supabase.rpc('sales_report', { p_from: from, p_to: to })).error.message, /Only an admin/)
  assert.equal((await supabase.from('expenses').select('id')).data.length, 0); ok('staff: no reports, no expenses (row-level security applies)')
  await supabase.auth.signOut()
  assert.equal((await supabase.from('products').select('id')).data.length, 0); ok('signed out: sees nothing')
}
