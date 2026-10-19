-- =====================================================================
-- Sample POS  |  Supabase schema
-- Paste the whole file into Supabase > SQL Editor > New query > Run
-- Safe to run on an empty project. Timezone for reports: Asia/Manila
-- Then run the numbered patch files in this folder, in order.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. STAFF PROFILES (linked to Supabase Auth users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now()
);

-- Every new Auth user automatically gets a profile with role 'staff'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'staff') from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- 2. PRODUCTS (goods and services)
-- add_on and add_on_pct match the "Add on per item" and "% on Add On"
-- columns of the costing sheet, and are calculated automatically
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,                 -- e.g. P05
  name           text not null,
  category       text not null default 'Other',
  kind           text not null default 'good' check (kind in ('good', 'service')),
  unit_cost      numeric(10,2) not null default 0 check (unit_cost >= 0),
  selling_price  numeric(10,2) not null check (selling_price >= 0),
  add_on         numeric(10,2) generated always as (selling_price - unit_cost) stored,
  add_on_pct     numeric(8,2)  generated always as (
                   case when unit_cost > 0
                        then round((selling_price - unit_cost) / unit_cost * 100, 2)
                   end) stored,
  stock_qty      integer not null default 0,           -- kept in sync by stock_movements
  reorder_level  integer not null default 5,
  is_active      boolean not null default true,        -- hide instead of delete
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. SALES (one row per receipt) and SALE ITEMS (one row per line)
-- Prices and costs are copied into sale_items at the moment of sale,
-- so changing a product price later never rewrites old reports
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id               uuid primary key default gen_random_uuid(),
  sale_no          bigint generated always as identity unique,   -- receipt number
  sold_at          timestamptz not null default now(),
  payment_method   text not null default 'cash'
                   check (payment_method in ('cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other')),
  subtotal         numeric(10,2) not null default 0 check (subtotal >= 0),
  discount         numeric(10,2) not null default 0 check (discount >= 0),
  total            numeric(10,2) not null default 0 check (total >= 0),
  amount_tendered  numeric(10,2),
  change_due       numeric(10,2),
  customer_name    text,
  note             text,
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  voided_at        timestamptz,
  voided_by        uuid references auth.users(id),
  void_reason      text,
  staff_id         uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now()
);

create table if not exists public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  product_code  text not null,
  product_name  text not null,
  qty           integer not null check (qty > 0),
  unit_price    numeric(10,2) not null,
  unit_cost     numeric(10,2) not null,
  line_total    numeric(12,2) generated always as (qty * unit_price) stored,
  line_cost     numeric(12,2) generated always as (qty * unit_cost) stored,
  line_profit   numeric(12,2) generated always as (qty * (unit_price - unit_cost)) stored
);

-- ---------------------------------------------------------------------
-- 4. STOCK MOVEMENTS (every change to inventory, with who and when)
-- purchase / void = stock in (positive qty)
-- sale / spoilage = stock out (negative qty)
-- adjustment      = either direction (admin only, for stock counts)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id) on delete restrict,
  movement_type  text not null check (movement_type in ('purchase', 'sale', 'void', 'spoilage', 'adjustment')),
  qty            integer not null check (qty <> 0),
  unit_cost      numeric(10,2),
  supplier       text,
  note           text,
  sale_id        uuid references public.sales(id) on delete set null,
  created_by     uuid references auth.users(id) default auth.uid(),
  occurred_at    timestamptz not null default now(),
  constraint movement_direction check (
       (movement_type in ('purchase', 'void')     and qty > 0)
    or (movement_type in ('sale', 'spoilage')     and qty < 0)
    or (movement_type = 'adjustment')
  )
);

-- Keep products.stock_qty in sync. A purchase with a unit cost also
-- updates the product's unit_cost to the latest buying price.
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.products
     set stock_qty = stock_qty + new.qty,
         unit_cost = case
                       when new.movement_type = 'purchase' and new.unit_cost is not null
                       then new.unit_cost
                       else unit_cost
                     end
   where id = new.product_id
     and kind = 'good';
  return new;
end $$;

drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------------------------------------------------------------------
-- 5. INDEXES (fast reports)
-- ---------------------------------------------------------------------
create index if not exists sales_sold_at_idx          on public.sales (sold_at);
create index if not exists sales_status_idx           on public.sales (status);
create index if not exists sale_items_sale_idx        on public.sale_items (sale_id);
create index if not exists sale_items_product_idx     on public.sale_items (product_id);
create index if not exists stock_movements_prod_idx   on public.stock_movements (product_id, occurred_at);

-- ---------------------------------------------------------------------
-- 6. FUNCTIONS THE POS CALLS
-- ---------------------------------------------------------------------

-- record_sale: the checkout button. Everything happens in one go, or
-- nothing happens (no half saved receipts).
-- p_items format: [{"product_id": "uuid", "qty": 2}, ...]
-- Prices are read from the products table, never trusted from the browser.
-- p_sold_at lets an admin enter past sales (e.g. from the old daily sheets).
create or replace function public.record_sale(
  p_items            jsonb,
  p_payment_method   text    default 'cash',
  p_discount         numeric default 0,
  p_amount_tendered  numeric default null,
  p_customer_name    text    default null,
  p_note             text    default null,
  p_sold_at          timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id   uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  numeric := 0;
  v_discount  numeric := coalesce(p_discount, 0);
  v_total     numeric;
  v_sold_at   timestamptz := case when p_sold_at is not null and public.is_admin() then p_sold_at else now() end;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  insert into public.sales (sold_at, payment_method, discount, customer_name, note, staff_id)
  values (v_sold_at, p_payment_method, v_discount, p_customer_name, p_note, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity in cart';
    end if;

    select * into v_product
      from public.products
     where id = (v_item->>'product_id')::uuid
       and is_active
       for update;

    if not found then
      raise exception 'Product not found or inactive';
    end if;

    -- Blocks selling more than is in stock. To allow negative stock while
    -- opening counts are still being set up, comment out this block.
    if v_product.kind = 'good' and v_product.stock_qty < v_qty then
      raise exception 'Not enough stock for % (have %, need %)',
        v_product.name, v_product.stock_qty, v_qty;
    end if;

    insert into public.sale_items (sale_id, product_id, product_code, product_name, qty, unit_price, unit_cost)
    values (v_sale_id, v_product.id, v_product.code, v_product.name, v_qty, v_product.selling_price, v_product.unit_cost);

    if v_product.kind = 'good' then
      insert into public.stock_movements (product_id, movement_type, qty, unit_cost, sale_id, occurred_at)
      values (v_product.id, 'sale', -v_qty, v_product.unit_cost, v_sale_id, v_sold_at);
    end if;

    v_subtotal := v_subtotal + v_qty * v_product.selling_price;
  end loop;

  if v_discount > v_subtotal then
    raise exception 'Discount is larger than the subtotal';
  end if;

  v_total := v_subtotal - v_discount;

  if p_amount_tendered is not null and p_amount_tendered < v_total then
    raise exception 'Amount tendered (%) is less than the total (%)', p_amount_tendered, v_total;
  end if;

  update public.sales
     set subtotal        = v_subtotal,
         total           = v_total,
         amount_tendered = p_amount_tendered,
         change_due      = case when p_amount_tendered is not null then p_amount_tendered - v_total end
   where id = v_sale_id;

  return v_sale_id;
end $$;

-- void_sale: admin only. Marks the receipt voided and puts the stock back.
-- Voided sales stay in the records for the audit trail.
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_line   record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void a sale';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a sale';
  end if;

  select status into v_status from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;
  if v_status = 'voided' then
    raise exception 'This sale is already voided';
  end if;

  update public.sales
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_sale_id;

  for v_line in
    select si.product_id, si.qty, si.unit_cost
      from public.sale_items si
      join public.products p on p.id = si.product_id
     where si.sale_id = p_sale_id and p.kind = 'good'
  loop
    insert into public.stock_movements (product_id, movement_type, qty, unit_cost, sale_id, note)
    values (v_line.product_id, 'void', v_line.qty, v_line.unit_cost, p_sale_id, 'Void: ' || p_reason);
  end loop;
end $$;

revoke all on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- Only logged in staff can see anything. Only admins edit products,
-- prices and stock counts. Sales can only be written through
-- record_sale / void_sale, never edited directly.
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.products        enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles admin"  on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles admin" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "products read"         on public.products;
drop policy if exists "products admin insert" on public.products;
drop policy if exists "products admin update" on public.products;
create policy "products read"         on public.products for select to authenticated using (public.is_staff());
create policy "products admin insert" on public.products for insert to authenticated with check (public.is_admin());
create policy "products admin update" on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sales read" on public.sales;
create policy "sales read" on public.sales for select to authenticated using (public.is_staff());

drop policy if exists "sale items read" on public.sale_items;
create policy "sale items read" on public.sale_items for select to authenticated using (public.is_staff());

drop policy if exists "stock read"   on public.stock_movements;
drop policy if exists "stock insert" on public.stock_movements;
create policy "stock read" on public.stock_movements for select to authenticated using (public.is_staff());
-- Staff can record deliveries and spoilage; only admins can do stock count adjustments
create policy "stock insert" on public.stock_movements for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_staff() and movement_type in ('purchase', 'spoilage'))
  );

-- ---------------------------------------------------------------------
-- 8. REPORT VIEWS (for the analytics tab). security_invoker keeps RLS on.
-- All dates are converted to Manila time.
-- ---------------------------------------------------------------------

-- Each receipt with its cost and gross profit
create or replace view public.v_sale_totals with (security_invoker = true) as
select
  s.id,
  s.sale_no,
  s.sold_at,
  (s.sold_at at time zone 'Asia/Manila')       as sold_at_local,
  (s.sold_at at time zone 'Asia/Manila')::date as sale_date,
  s.payment_method,
  s.subtotal,
  s.discount,
  s.total,
  s.status,
  s.staff_id,
  coalesce(sum(si.line_cost), 0)               as cost,
  s.total - coalesce(sum(si.line_cost), 0)     as gross_profit,
  coalesce(sum(si.qty), 0)                     as items_count
from public.sales s
left join public.sale_items si on si.sale_id = s.id
group by s.id;

-- Daily summary, including the cash vs digital split for closing the drawer
create or replace view public.v_daily_sales with (security_invoker = true) as
select
  sale_date,
  count(*)                                                        as receipts,
  sum(items_count)                                                as items_sold,
  sum(total)                                                      as revenue,
  sum(discount)                                                   as discounts,
  sum(cost)                                                       as cost,
  sum(gross_profit)                                               as gross_profit,
  sum(total) filter (where payment_method = 'cash')               as cash_total,
  sum(total) filter (where payment_method in ('gcash', 'maya'))   as ewallet_total,
  sum(total) filter (where payment_method not in ('cash', 'gcash', 'maya')) as other_total
from public.v_sale_totals
where status = 'completed'
group by sale_date;

-- Monthly summary
create or replace view public.v_monthly_sales with (security_invoker = true) as
select
  date_trunc('month', sale_date)::date as month,
  count(*)           as receipts,
  sum(total)         as revenue,
  sum(cost)          as cost,
  sum(gross_profit)  as gross_profit
from public.v_sale_totals
where status = 'completed'
group by 1;

-- Best sellers and most profitable items (line totals are before receipt discounts)
create or replace view public.v_product_performance with (security_invoker = true) as
select
  p.id as product_id,
  p.code,
  p.name,
  p.category,
  p.selling_price,
  p.unit_cost,
  p.add_on_pct,
  p.stock_qty,
  coalesce(sum(si.qty)         filter (where s.status = 'completed'), 0) as units_sold,
  coalesce(sum(si.line_total)  filter (where s.status = 'completed'), 0) as revenue,
  coalesce(sum(si.line_cost)   filter (where s.status = 'completed'), 0) as cost,
  coalesce(sum(si.line_profit) filter (where s.status = 'completed'), 0) as profit,
  max(s.sold_at)               filter (where s.status = 'completed')     as last_sold_at
from public.products p
left join public.sale_items si on si.product_id = p.id
left join public.sales s       on s.id = si.sale_id
group by p.id;

-- Busiest hours and days for the POS (0 = Sunday)
create or replace view public.v_sales_by_hour with (security_invoker = true) as
select
  extract(dow  from sold_at_local)::int as day_of_week,
  extract(hour from sold_at_local)::int as hour_of_day,
  count(*)    as receipts,
  sum(total)  as revenue
from public.v_sale_totals
where status = 'completed'
group by 1, 2;

-- Items that need restocking
create or replace view public.v_low_stock with (security_invoker = true) as
select id, code, name, category, stock_qty, reorder_level
from public.products
where is_active and kind = 'good' and stock_qty <= reorder_level
order by stock_qty asc;

-- ---------------------------------------------------------------------
-- 9. STARTING PRODUCTS (from the costing sheet)
-- Stock starts at 0. Record opening stock as a 'purchase' movement.
-- ---------------------------------------------------------------------
insert into public.products (code, name, category, unit_cost, selling_price) values
  ('P05', 'Sports Drink (500ml)',   'Drinks',      28.00,  50.00),
  ('P09', 'Electrolyte Drink',      'Drinks',      38.00,  60.00),
  ('P10', 'Energy Drink',           'Drinks',      42.00,  65.00),
  ('P12', 'Diet Soda',              'Drinks',      24.00,  35.00),
  ('P16', 'Soy Milk',               'Drinks',      32.00,  45.00),
  ('P17', 'Whey Protein (scoop)',   'Supplements', 55.00,  90.00),
  ('P19', 'Pre-workout (scoop)',    'Supplements', 41.00,  70.00),
  ('P21', 'Protein Bar',            'Snacks',      90.00, 120.00),
  ('P22', 'Banana Chips',           'Snacks',      18.00,  30.00),
  ('P23', 'Bottled Water (500ml)',  'Drinks',       9.00,  20.00),
  ('P24', 'Chocolate Milk',         'Drinks',      22.00,  35.00)
on conflict (code) do nothing;

-- =====================================================================
-- AFTER RUNNING
-- 1. Authentication > Users > Add user (yourself), then make yourself admin:
--      update public.profiles set role = 'admin'
--      where id = (select id from auth.users where email = 'you@example.com');
-- 2. Record opening stock, one row per product, e.g.:
--      insert into public.stock_movements (product_id, movement_type, qty, unit_cost, note)
--      select id, 'purchase', 24, unit_cost, 'Opening stock' from public.products where code = 'P05';
-- =====================================================================
