// Runs schema.sql + every numbered patch in a real Postgres (PGlite, in-process), then
// checks permissions, checkout, stock and reports as staff / admin / inactive users.
// npm run test:db
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const dir = new URL('.', import.meta.url)
const files = ['schema.sql', ...readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()]
const db = new PGlite()
// Minimal Supabase stand-in: auth schema, auth.uid() from a session setting, the two API roles.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`)
// Each file twice: patches must be safe to re-run.
for (const f of [...files, ...files.slice(1)]) {
  await db.exec(readFileSync(new URL(f, dir), 'utf8').replace(/create extension[^;]*;/i, '')) // gen_random_uuid is core
}
console.log(`applied ${files.join(', ')} (patches twice)`)
const A = '00000000-0000-0000-0000-00000000000a', S = '00000000-0000-0000-0000-00000000000b', X = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}', 'admin@x', '{"full_name":"Ana Admin"}'), ('${S}', 'staff@x', '{"full_name":"Sam Staff"}'), ('${X}', 'rand@x', '{}');
  update public.profiles set role = 'admin' where id = '${A}'; update public.profiles set role = 'staff' where id = '${S}';`)
const as = async (uid, sql, params) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
  await db.exec('set role authenticated')
  try { return (await db.query(sql, params)).rows } finally { await db.exec('reset role') }
}
const fails = async (uid, sql, re, params) => { await assert.rejects(as(uid, sql, params), re); }
const one = async (sql) => (await db.query(sql)).rows[0]
const gid = (await one(`select id from products where code = 'P05'`)).id
let n = 0; const ok = (m) => console.log(`  ✓ ${++n} ${m}`)

assert.equal((await one(`select role from profiles where id = '${X}'`)).role, 'inactive'); ok('new sign-up starts inactive')
assert.equal((await as(X, 'select * from products')).length, 0); ok('inactive user sees no products')
await fails(X, `select record_sale('[{"product_id":"${gid}","qty":1}]')`, /Not authorized/); ok('inactive user cannot sell')

await as(S, `insert into stock_movements (product_id, movement_type, qty, unit_cost, note, created_by) values ($1, 'purchase', 24, 27.21, 'Opening', $2)`, [gid, S])
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 24); ok('staff receives delivery, stock 24')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'purchase', 5, $2)`, /row-level security/, [gid, A]); ok('cannot sign a movement as someone else')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'sale', -5, $2)`, /row-level security/, [gid, S]); ok('cannot fake a sale movement')

const sale = `select record_sale($1::jsonb, 'cash', 0, 200, null, null, null, $2::uuid) as id`
const items = JSON.stringify([{ product_id: gid, qty: 2 }]), ref = '11111111-1111-1111-1111-111111111111'
const id1 = (await as(S, sale, [items, ref]))[0].id, id2 = (await as(S, sale, [items, ref]))[0].id
assert.equal(id1, id2); assert.equal((await one('select count(*)::int c from sales')).c, 1); ok('retry with same client_ref returns the same sale, no duplicate')
const s1 = await one(`select total, change_due from sales where id='${id1}'`); assert.equal(+s1.total, 100); assert.equal(+s1.change_due, 100); ok('total ₱100, change ₱100 from ₱200')
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 22); ok('stock 22 after sale')
await fails(S, `select record_sale($1::jsonb)`, /Not enough stock/, [JSON.stringify([{ product_id: gid, qty: 30 }])]); ok('overselling blocked')

await as(S, `update products set selling_price = 55 where id = $1`, [gid])
const ch = await one(`select field, old_value, new_value, changed_by from product_changes where product_id='${gid}' and field='selling_price'`)
assert.deepEqual([ch.old_value, ch.new_value, ch.changed_by], ['50.00', '55.00', S]); ok('staff price change 50 → 55 logged under staff')
await fails(S, `update products set stock_qty = 999 where id = $1`, /permission denied/, [gid]); ok('stock_qty cannot be edited directly')
await fails(S, `insert into products (code, name, selling_price, stock_qty) values ('T1','x',1,50)`, /permission denied/); ok('new product cannot start with made-up stock')
await as(S, `insert into products (code, name, category, kind, selling_price) values ('MEM-M','Monthly','Membership','service',1200)`)
assert.equal((await one(`select count(*)::int c from product_changes where field='created'`)).c, 1); ok('staff adds a membership product, creation logged')

assert.equal((await as(S, `select set_stock_count($1, 20) as d`, [gid]))[0].d, -2)
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 20); ok('stock count 20 records a −2 adjustment')
assert.equal((await as(S, `select set_stock_count($1, 20) as d`, [gid]))[0].d, 0); ok('matching count records nothing')
await fails(S, `select set_stock_count(id, 3) from products where code='MEM-M'`, /no stock/); ok('services cannot be counted')
assert.equal((await as(S, `select full_name from profiles`)).length, 3); ok('staff can see team names for history')

await fails(S, `select sales_report(current_date - 7, current_date)`, /Only an admin/); ok('staff cannot open reports')
const mid = (await one(`select id from products where code='MEM-M'`)).id
const gcashCart = JSON.stringify([{ product_id: mid, qty: 1 }, { product_id: gid, qty: 1 }])
await fails(S, `select record_sale($1::jsonb, 'gcash')`, /last 4 digits/, [gcashCart]); ok('gcash without a reference is blocked')
await fails(S, `select record_sale($1::jsonb, 'gcash', 0, null, null, null, null, null, '12a4')`, /last 4 digits/, [gcashCart]); ok('gcash reference must be 4 digits')
const gid2 = (await as(S, `select record_sale($1::jsonb, 'gcash', 0, null, null, null, null, null, '0427') as id`, [gcashCart]))[0].id
assert.equal((await one(`select payment_ref from sales where id='${gid2}'`)).payment_ref, '0427'); ok('gcash reference saved on the sale')
const r = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.equal(+r.totals.revenue, 100 + 1255); assert.equal(r.totals.receipts, 2); assert.equal(r.daily.length, 7)
assert.equal(r.staff[0].name, 'Sam Staff'); assert.equal(+r.staff[0].memberships, 1)
assert.deepEqual(r.categories.map((c) => c.category).sort(), ['Drinks', 'Membership']); assert.equal(r.payments.length, 2)
ok(`admin report: revenue ₱${r.totals.revenue}, 2 receipts, 7 days, staff + membership + payments`)
await as(A, `select void_sale($1, 'Wrong item')`, [id1])
assert.equal((await one(`select stock_qty from products where id='${gid}'`)).stock_qty, 21)
const r2 = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.equal(r2.voids.count, 1); assert.equal(r2.totals.receipts, 1); ok('void puts stock back and moves the sale out of totals')
await fails(A, `select sales_report(current_date, current_date - 1)`, /valid date range/); ok('bad range rejected')
// 004: sales are admin-only; staff see their own receipts only.
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d', 'staff2@x', '{"full_name":"Tess Two"}');
  update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000000d';`)
const T = '00000000-0000-0000-0000-00000000000d'
assert.equal((await as(T, 'select * from sales')).length, 0); ok('staff cannot see sales they did not ring up')
assert.equal((await as(T, 'select * from sale_items')).length, 0); ok('…or their line items')
const own = (await as(T, `select record_sale($1::jsonb, 'cash') as id`, [JSON.stringify([{ product_id: gid, qty: 1 }])]))[0].id
assert.deepEqual((await as(T, 'select id from sales')).map((x) => x.id), [own]); ok('staff can read back their own receipt')
assert.ok((await as(A, 'select count(*)::int c from sales'))[0].c >= 3); ok('admin sees every sale')

// 004: delete_product.
await fails(S, `select delete_product($1)`, /Only an admin/, [gid]); ok('staff cannot delete products')
await as(A, `insert into products (code, name, selling_price) values ('TMP1', 'Never sold', 10)`)
const tmp = (await one(`select id from products where code = 'TMP1'`)).id
await as(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'purchase', 5, $2)`, [tmp, S])
assert.equal((await as(A, `select delete_product($1) as r`, [tmp]))[0].r, 'deleted')
assert.equal((await one(`select count(*)::int c from products where id = '${tmp}'`)).c, 0); ok('unsold product is deleted completely, with its stock history')
assert.equal((await as(A, `select delete_product($1) as r`, [gid]))[0].r, 'archived')
const arch = await one(`select is_active, deleted_at, code from products where id = '${gid}'`)
assert.ok(!arch.is_active && arch.deleted_at && arch.code.startsWith('P05 (deleted')); ok('sold product is archived and its code freed')
await as(A, `insert into products (code, name, selling_price) values ('P05', 'Sports Drink v2', 50)`); ok('the freed code can be reused')
const r3 = (await as(A, `select sales_report((now() at time zone 'Asia/Manila')::date - 6, (now() at time zone 'Asia/Manila')::date) as r`))[0].r
assert.ok(r3.products.some((p) => p.product_id === gid)); ok('archived product still appears in reports')
await fails(A, `select delete_product($1)`, /not found/, [gid]); ok('cannot delete twice')
// 005: staff management.
await fails(S, 'select * from staff_list()', /Only an admin/); ok('staff cannot list accounts')
const list = await as(A, 'select * from staff_list()')
assert.equal(list[0].email, 'admin@x'); assert.ok(list.some((x) => x.email === 'rand@x' && x.role === 'inactive')); ok('admin lists accounts with emails, admins first')
await fails(A, `update profiles set role = 'staff' where id = $1`, /at least one admin/, [A]); ok('the last admin cannot be demoted')
await as(A, `update profiles set role = 'admin', full_name = 'Rand Promoted' where id = $1`, [X])
await as(A, `update profiles set role = 'staff' where id = $1`, [A]); ok('with a second admin, the first can step down')
await fails(S, `update profiles set role = 'admin' where id = $1`, /row-level security|0 rows/, [S]).catch(async () => {
  assert.equal((await one(`select role from profiles where id = '${S}'`)).role, 'staff')
}); ok('staff cannot promote themselves')
await fails(X, `update profiles set created_at = now() where id = $1`, /permission denied/, [X]); ok('only name and role are editable')
// 006: expenses.
await db.exec(`update profiles set role = 'admin' where id = '${A}'`) // A stepped down in the 005 checks
const cat = (await one(`select id from expense_categories where name = 'Electricity'`)).id
await fails(S, 'select count(*) from expense_categories', /./).catch(() => {})
assert.equal((await as(S, 'select * from expense_categories')).length, 0); ok('staff cannot see expense categories')
await fails(S, `insert into expenses (expense_date, category_id, description, amount) values (current_date, $1, 'x', 10)`, /row-level security/, [cat]); ok('staff cannot record expenses')
await fails(A, `insert into expenses (expense_date, category_id, description, amount, created_by) values (current_date, $1, 'x', 10, $2)`, /permission denied|row-level/, [cat, S]); ok('cannot record an expense in someone else’s name')
const today = (await one(`select (now() at time zone 'Asia/Manila')::date::text d`)).d
const ex1 = (await as(A, `insert into expenses (expense_date, category_id, description, amount, payment_method, reference_no) values ($1, $2, 'VECO bill', 4200, 'bank_transfer', 'OR-123') returning id`, [today, cat]))[0].id
await as(A, `update expenses set amount = 4250 where id = $1`, [ex1])
const exch = await as(A, `select field, old_value, new_value, changed_by from expense_changes where expense_id = $1 order by id`, [ex1])
assert.deepEqual(exch.map((c) => c.field), ['created', 'amount']); assert.equal(exch[1].old_value, '4200.00'); assert.equal(exch[1].changed_by, A); ok('expense edits are logged with who and the old value')
await fails(A, `delete from expenses where id = $1`, /permission denied/, [ex1]); ok('expenses can never be deleted')
await fails(A, `select void_expense($1, '  ')`, /reason is required/, [ex1]); ok('voiding needs a reason')
await fails(A, `update expenses set status = 'voided' where id = $1`, /permission denied/, [ex1]); ok('status only changes through void_expense')
const bill = (await as(A, `insert into recurring_expenses (name, category_id, usual_amount, due_day) values ('VECO', $1, 4000, 15) returning id`, [cat]))[0].id
const recBill = `insert into expenses (expense_date, category_id, description, amount, recurring_id, for_month) values ($1, $2, 'VECO October', 4100, $3, date_trunc('month', $1::date)::date) returning id`
const b1 = (await as(A, recBill, [today, cat, bill]))[0].id
await fails(A, recBill, /duplicate key|unique/, [today, cat, bill]); ok('a monthly bill can only be recorded once per month')
await as(A, `select void_expense($1, 'Wrong amount')`, [b1])
await fails(A, `update expenses set amount = 1 where id = $1 returning id`, /./, [b1]).catch(async () => assert.equal(+(await one(`select amount from expenses where id = '${b1}'`)).amount, 4100))
assert.equal(+(await one(`select amount from expenses where id = '${b1}'`)).amount, 4100); ok('a voided expense cannot be edited')
await as(A, recBill, [today, cat, bill]); ok('after voiding, that month’s bill can be recorded again')
const r4 = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r
assert.equal(+r4.expenses.total, 4250 + 4100); assert.equal(r4.expenses.by_category[0].category, 'Electricity')
assert.equal(r4.daily.at(-1).expenses, 8350); ok(`report: expenses ₱${r4.expenses.total} by category and per day (voided excluded)`)
assert.ok('gross_profit' in r4.totals && 'previous' in r4.expenses); ok('net profit inputs present (gross profit − expenses)')
await as(A, `insert into storage.objects (bucket_id, name) values ('receipts', '2026/10/a.jpg')`)
await fails(S, `insert into storage.objects (bucket_id, name) values ('receipts', 'x.jpg')`, /row-level security/); ok('only admins can upload receipt files')
assert.equal((await as(S, `select * from storage.objects where bucket_id = 'receipts'`)).length, 0); ok('staff cannot see receipt files')
// 007: payroll.
assert.equal((await as(S, 'select * from employees')).length, 0)
assert.equal((await as(S, 'select * from payroll_rates')).length, 0); ok('staff cannot see employees or payroll rates')
assert.equal((await one(`select count(*)::int c from payroll_rates`)).c, 4); ok('2025 rate seeds present (sss, philhealth, pagibig, tax)')
const emp = (await as(A, `insert into employees (full_name, pay_frequency, pay_basis, rate) values ('Coach Karl', 'semi_monthly', 'monthly', 20000) returning id`))[0].id
await as(A, `update employees set rate = 22000 where id = $1`, [emp])
const ech = await as(A, `select field, old_value, new_value from employee_changes where employee_id = $1 order by id`, [emp])
assert.deepEqual(ech.map((c) => [c.field, c.old_value, c.new_value]), [['created', null, 'Coach Karl'], ['rate', '20000.00', '22000.00']]); ok('employee rate changes are logged')
await fails(A, `delete from employees where id = $1`, /permission denied/, [emp]); ok('employees cannot be deleted (deactivate instead)')
const run = (await as(A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('semi_monthly', $1::date - 14, $1::date, $1::date) returning id`, [today]))[0].id
await as(A, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, gross_pay, sss_ee, sss_er, sss_ec, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, taxable_income, net_pay)
             values ($1, $2, 'Coach Karl', 'monthly', 22000, 11000, 11000, 550, 1100, 10, 275, 275, 200, 200, 9975, 9975)`, [run, emp])
await as(A, `update payroll_items set overtime_pay = 0 where run_id = $1`, [run]); ok('draft payslips are editable')
await fails(A, `update payroll_runs set status = 'finalized' where id = $1`, /permission denied/, [run]); ok('status only changes through finalize/void')
await fails(S, `select finalize_payroll($1, '{}')`, /Only an admin/, [run]); ok('staff cannot finalize payroll')
const before = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total
await as(A, `select finalize_payroll($1, '{"sss":{"id":"x"}}')`, [run])
const posted = await as(A, `select c.name, e.amount, e.status from expenses e join expense_categories c on c.id = e.category_id where payroll_run_id = $1 order by c.name`, [run])
assert.deepEqual(posted.map((p) => [p.name, +p.amount]), [['Government contributions', 1585], ['Payroll', 11000]]); ok('finalize posts salaries (₱11,000) and employer contributions (₱1,585) to Expenses')
const after = (await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total
assert.equal(+after - +before, 12585); ok('analytics expenses include the payroll')
assert.equal((await one(`select rates from payroll_runs where id = '${run}'`)).rates.sss.id, 'x'); ok('the rates used are stored on the run')
await as(A, `update payroll_items set basic_pay = 1 where run_id = $1`, [run])
assert.equal(+(await one(`select basic_pay from payroll_items where run_id = '${run}'`)).basic_pay, 11000); ok('finalized payslips are locked')
await fails(A, `delete from payroll_runs where id = $1 returning id`, /./, [run]).catch(async () => assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run}'`)).c, 1))
assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run}'`)).c, 1); ok('finalized runs cannot be deleted')
await fails(A, `select finalize_payroll($1, '{}')`, /already finalized/, [run]); ok('cannot finalize twice')
const payEx = (await one(`select id from expenses where payroll_run_id = '${run}' limit 1`)).id
await fails(A, `select void_expense($1, 'x')`, /void the pay run/, [payEx]); ok('payroll expenses can only be undone from Payroll')
await as(A, `update expenses set amount = 1 where id = $1`, [payEx])
assert.ok(+(await one(`select amount from expenses where id = '${payEx}'`)).amount > 1); ok('payroll expenses cannot be edited in Expenses')
await fails(A, `select void_payroll_run($1, '')`, /reason is required/, [run])
await as(A, `select void_payroll_run($1, 'Wrong period')`, [run])
assert.deepEqual((await as(A, `select distinct status from expenses where payroll_run_id = $1`, [run])).map((x) => x.status), ['voided'])
assert.equal(+(await as(A, `select sales_report($1::date - 6, $1::date) as r`, [today]))[0].r.expenses.total, +before); ok('voiding a run voids its expenses and removes them from analytics')
const run2 = (await as(A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('monthly', $1::date - 30, $1::date, $1::date) returning id`, [today]))[0].id
await as(A, `insert into payroll_items (run_id, employee_id, employee_name, pay_basis, rate, basic_pay, gross_pay, other_deductions, net_pay) values ($1, $2, 'Coach Karl', 'monthly', 1, 100, 100, 500, -400)`, [run2, emp])
await fails(A, `select finalize_payroll($1, '{}')`, /negative net pay/, [run2]); ok('a payslip with negative net pay blocks finalizing')
await as(A, `delete from payroll_runs where id = $1`, [run2])
assert.equal((await one(`select count(*)::int c from payroll_runs where id = '${run2}'`)).c, 0); ok('draft runs can be deleted')
await as(A, `insert into payroll_rates (kind, effective_from, config) values ('sss', '2026-01-01', '{"ee_rate":0.05}')`)
await fails(A, `update payroll_rates set notes = 'x'`, /permission denied/); ok('new rate versions can be added; old ones never edited')
console.log('all passed')
