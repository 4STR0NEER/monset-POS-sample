// Dummy data for the demo, made fresh on first open: logins, products and stock, about three
// months of sales, bills and expenses, employees and finalized pay runs. All of it goes through
// the same database functions the app uses (record_sale, finalize_payroll…), so it is consistent.
import { EMPTY_PRIOR, addToPrior, computePayslip, ratesOn, suggestedBasic } from './payroll.js'

export const DEMO_PASSWORD = 'demo1234'
export const DEMO_USERS = [
  ['admin@demo.test', 'Alex Morgan', 'admin'],
  ['sam@demo.test', 'Sam Rivera', 'staff'],
  ['jo@demo.test', 'Jo Bennett', 'staff'],
  ['pat@demo.test', 'Pat Lee', 'inactive'],
]
const DAYS = 90

// Minimal Supabase stand-in (same as supabase/test.mjs): auth schema, auth.uid() from a
// session setting, the API role, a storage table that keeps uploaded files in the database.
const STUB = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, password text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), content_type text, data bytea);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create table public.demo_meta (version int);
`

// A fresh database: the stand-in above, schema.sql and every patch in order, then the dummy data.
export async function install(db, sqlFiles) {
  await db.exec(STUB)
  for (const text of sqlFiles) await db.exec(text.replace(/create extension[^;]*;/i, '')) // gen_random_uuid is core
  await seed(db)
}

// Each statement runs as that user: auth.uid() and is_admin() see them.
async function asUser(db, uid, text, params) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    return (await tx.query(text, params)).rows
  })
}

async function seed(db) {
  const ids = {}
  for (const [email, name, role] of DEMO_USERS) {
    const { rows } = await db.query(`insert into auth.users (email, password, raw_user_meta_data) values ($1, $2, $3) returning id`, [email, DEMO_PASSWORD, JSON.stringify({ full_name: name })])
    ids[role === 'admin' ? 'admin' : email] = rows[0].id
    await db.query(`update profiles set role = $2, created_at = now() - interval '${DAYS + 10} days' where id = $1`, [rows[0].id, role])
  }
  const A = ids.admin, S = [ids['sam@demo.test'], ids['jo@demo.test'], A]

  // Memberships and services (no stock), then opening stock for every good.
  await asUser(db, A, `insert into products (code, name, category, kind, unit_cost, selling_price, reorder_level) values
    ('M-DAY', 'Day pass', 'Membership', 'service', 0, 150, 0),
    ('M-MON', 'Monthly membership', 'Membership', 'service', 0, 1500, 0),
    ('M-QTR', '3-month membership', 'Membership', 'service', 0, 4000, 0),
    ('S-PT', 'Personal training session', 'Services', 'service', 0, 500, 0),
    ('S-TWL', 'Towel rental', 'Services', 'service', 0, 30, 0)`)
  await db.query(`update products set created_at = now() - interval '${DAYS + 5} days'`)
  await asUser(db, A, `insert into stock_movements (product_id, movement_type, qty, unit_cost, supplier, note, occurred_at)
    select id, 'purchase', 400, unit_cost, 'Metro Wholesale', 'Opening stock', now() - interval '${DAYS + 1} days' from products where kind = 'good'`)

  // Sales: 6 to 18 a day from 6am to 9pm Manila time, mostly cash, some GCash and card.
  await asUser(
    db,
    A,
    `do $$
    declare d date; n int; ts timestamptz; cart jsonb; m text; sid uuid; staff uuid[] := $s$${`{${S.join(',')}}`}$s$;
    begin
      perform setseed(0.42);
      for d in select generate_series(current_date - ${DAYS}, current_date, '1 day')::date loop
        n := 6 + floor(random() * 13)::int + case when extract(isodow from d) in (1, 3) then 4 else 0 end;
        for i in 1..n loop
          ts := (d + make_interval(hours => 6 + floor(random() * 15)::int, mins => floor(random() * 60)::int)) at time zone 'Asia/Manila';
          continue when ts > now();
          select jsonb_agg(jsonb_build_object('product_id', id, 'qty', 1 + floor(random() * 2)::int)) into cart
            from (select id from products where kind = 'good' and stock_qty > 5 order by random() limit 1 + floor(random() * 2)::int) p;
          if random() < 0.3 then
            cart := coalesce(cart, '[]') || jsonb_build_object('product_id', (select id from products where category in ('Membership', 'Services') order by random() limit 1), 'qty', 1);
          end if;
          continue when cart is null;
          m := case when random() < 0.65 then 'cash' when random() < 0.75 then 'gcash' else 'card' end;
          sid := public.record_sale(cart, m, 0, null, case when random() < 0.2 then (array['Maria', 'John', 'Kim', 'Leo', 'Ana', 'Mark'])[1 + floor(random() * 6)::int] end,
                                    null, ts, null, case when m = 'gcash' then lpad(floor(random() * 10000)::text, 4, '0') end);
          update sales set staff_id = staff[1 + floor(random() * 3)::int] where id = sid;
        end loop;
      end loop;
    end $$`,
  )
  await db.query(`update stock_movements m set created_by = s.staff_id from sales s where m.sale_id = s.id`)
  for (const [k, reason] of [[40, 'Rang up the wrong item'], [17, 'Customer changed their mind'], [5, 'Duplicate receipt']]) {
    const [r] = (await db.query(`select id from sales where sold_at::date = current_date - ${k} order by sold_at limit 1`)).rows
    if (r) await asUser(db, A, `select void_sale($1, $2)`, [r.id, reason])
  }
  // A restock a month ago, some spoilage, and a few shelves running low.
  await asUser(db, S[0], `insert into stock_movements (product_id, movement_type, qty, unit_cost, supplier, note, occurred_at, created_by)
    select id, 'purchase', 48, unit_cost, 'Metro Wholesale', 'Weekly delivery', now() - interval '30 days', auth.uid() from products where category = 'Drinks'`)
  await asUser(db, S[1], `insert into stock_movements (product_id, movement_type, qty, note, occurred_at, created_by)
    select id, 'spoilage', -3, 'Past expiry', now() - interval '12 days', auth.uid() from products where code = 'P24'`)
  for (const [code, n] of [['P10', 3], ['P21', 4], ['P19', 0]]) await asUser(db, S[0], `select set_stock_count(id, $1, 'Shelf count') from products where code = $2`, [n, code])

  // Monthly bills, recorded for each past month (and this month's if already due), plus one-off expenses.
  const cat = Object.fromEntries((await db.query('select name, id from expense_categories')).rows.map((r) => [r.name, r.id]))
  const bills = [
    ['Rent', 'Rent', 35000, 'Northside Properties', 5],
    ['Electricity', 'Electricity', 9800, 'City Power Co.', 15],
    ['Water', 'Water', 1400, 'Metro Water', 18],
    ['Internet', 'Internet & phone', 1899, 'FiberNet', 10],
  ]
  for (const [name, c, amt, vendor, day] of bills) {
    const [{ id }] = await asUser(db, A, `insert into recurring_expenses (name, category_id, usual_amount, vendor, due_day) values ($1, $2, $3, $4, $5) returning id`, [name, cat[c], amt, vendor, day])
    await asUser(
      db,
      A,
      `insert into expenses (expense_date, category_id, description, amount, payment_method, vendor, reference_no, recurring_id, for_month, created_by)
       select (m + ($4 - 1) * interval '1 day')::date, $1, $5 || ' – ' || to_char(m, 'FMMonth YYYY'),
              round(($2 * (case when $5 in ('Electricity', 'Water') then 0.85 + random() * 0.3 else 1 end))::numeric, 2),
              'bank_transfer', $3, 'OR-' || (10000 + floor(random() * 89999))::int, $6, m::date, auth.uid()
         from generate_series(date_trunc('month', current_date - ${DAYS}), date_trunc('month', current_date), '1 month') m
        where (m + ($4 - 1) * interval '1 day')::date between current_date - ${DAYS} and current_date`,
      [cat[c], amt, vendor, day, name, id],
    )
  }
  const extras = [
    [70, 'Supplies', 'Cleaning supplies and disinfectant', 2350, 'cash', 'CleanPro'],
    [52, 'Repairs & maintenance', 'Treadmill belt replacement', 6800, 'gcash', 'FitFix Services'],
    [33, 'Equipment', 'Two 20kg dumbbells', 7400, 'card', 'Iron Supply'],
    [26, 'Marketing', 'Flyers and tarpaulin', 1850, 'cash', 'PrintHub'],
    [9, 'Supplies', 'Towels (12 pcs)', 2160, 'cash', 'Home Depot'],
    [3, 'Permits, fees & taxes', 'Barangay clearance renewal', 1500, 'cash', null],
  ]
  for (const [ago, c, desc, amt, pay, vendor] of extras)
    await asUser(db, A, `insert into expenses (expense_date, category_id, description, amount, payment_method, vendor, created_by) values (current_date - $1::int, $2, $3, $4, $5, $6, auth.uid())`, [ago, cat[c], desc, amt, pay, vendor])

  // Employees and their semi-monthly pay runs, computed the way the Pay run page does it.
  const emps = []
  for (const e of [
    ['Sam Rivera', 'Front desk', S[0], 'monthly', 18000, '34-1234567-8', '12-345678901-2', '1234-5678-9012', '123-456-789-000'],
    ['Jo Bennett', 'Front desk / coach', S[1], 'monthly', 22000, '34-2345678-9', '12-456789012-3', '2345-6789-0123', '234-567-890-000'],
    ['Chris Tan', 'Cleaner', null, 'daily', 645, '34-3456789-0', null, null, null],
  ]) {
    const [row] = await asUser(
      db,
      A,
      `insert into employees (full_name, position, profile_id, pay_frequency, pay_basis, rate, sss_no, philhealth_no, pagibig_no, tin, start_date, minimum_wage_earner)
       values ($1, $2, $3, 'semi_monthly', $4, $5, $6, $7, $8, $9, current_date - 400, $4 = 'daily') returning *`,
      e,
    )
    emps.push(row)
  }
  const rateRows = (await db.query(`select id, kind, effective_from::text, config from payroll_rates`)).rows
  const prior = {}
  const today = new Date()
  const periods = []
  for (let k = 3; k >= 1; k--) {
    const y = today.getFullYear(), m = today.getMonth() - k
    const iso = (d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
    periods.push([iso(1), iso(15)], [iso(16), new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)])
  }
  for (const [from, to] of periods) {
    if (from.endsWith('-01')) for (const e of emps) prior[e.id] = EMPTY_PRIOR
    const rates = ratesOn(rateRows, to)
    const [run] = await asUser(db, A, `insert into payroll_runs (pay_frequency, period_start, period_end, pay_date) values ('semi_monthly', $1, $2, $2) returning id`, [from, to])
    for (const e of emps) {
      const inp = { basic_pay: suggestedBasic(e, { days: 13 }), overtime_pay: 0, allowances_taxable: 0, allowances_nontaxable: e.pay_basis === 'daily' ? 0 : 1000, other_deductions: 0 }
      const slip = computePayslip(inp, { ...e, contributions_enabled: true }, rates, prior[e.id])
      const item = { run_id: run.id, employee_id: e.id, employee_name: e.full_name, pay_basis: e.pay_basis, rate: e.rate, days_worked: e.pay_basis === 'daily' ? 13 : null, ...slip }
      const cols = Object.keys(item).join(', ')
      await asUser(db, A, `insert into payroll_items (${cols}) select ${cols} from json_populate_record(null::payroll_items, $1)`, [JSON.stringify(item)])
      prior[e.id] = addToPrior(prior[e.id], item)
    }
    await asUser(db, A, `select finalize_payroll($1, $2)`, [run.id, JSON.stringify(rates)])
  }
  await db.query(`update payroll_runs set created_at = pay_date, finalized_at = pay_date + interval '9 hours'`)
}
