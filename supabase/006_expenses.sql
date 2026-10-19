-- =====================================================================
-- 006  Expenses, monthly bills and net profit. Admin only. Safe to re-run.
-- Audit rules: expenses are never deleted, only voided with a reason;
-- every edit is logged with who and when; a monthly bill can be
-- recorded once per month.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Categories (editable by admins; hide instead of delete).
-- ---------------------------------------------------------------------
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.expense_categories (name) values
  ('Rent'), ('Electricity'), ('Water'), ('Internet & phone'), ('Payroll'),
  ('Government contributions'), ('Supplies'), ('Equipment'), ('Repairs & maintenance'),
  ('Marketing'), ('Permits, fees & taxes'), ('Other')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 2. Monthly bills: templates for what comes every month. The amount is
-- only the usual figure; each month's real amount is entered when the
-- bill is recorded (electricity and water change month to month).
-- ---------------------------------------------------------------------
create table if not exists public.recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category_id     uuid not null references public.expense_categories(id),
  usual_amount    numeric(12,2) check (usual_amount is null or usual_amount >= 0),
  vendor          text,
  due_day         integer check (due_day between 1 and 31),
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Expenses.
-- expense_date = the day the money went out (Manila date); reports and
-- net profit use it. for_month = which month a monthly bill covers.
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date not null,
  category_id     uuid not null references public.expense_categories(id),
  description     text not null check (length(trim(description)) > 0),
  amount          numeric(12,2) not null check (amount > 0),
  payment_method  text not null default 'cash'
                  check (payment_method in ('cash', 'gcash', 'maya', 'card', 'bank_transfer', 'check', 'other')),
  vendor          text,
  reference_no    text,                       -- OR / invoice / check number
  receipt_path    text,                       -- file in the private 'receipts' storage bucket
  notes           text,
  recurring_id    uuid references public.recurring_expenses(id),
  for_month       date check (for_month is null or for_month = date_trunc('month', for_month)::date),
  status          text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason     text,
  voided_by       uuid references auth.users(id),
  voided_at       timestamptz,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (expense_date);
create index if not exists expenses_category_idx on public.expenses (category_id);
-- One recorded entry per bill per month (a voided one can be re-recorded).
create unique index if not exists expenses_bill_month_uniq
  on public.expenses (recurring_id, for_month) where status = 'recorded' and recurring_id is not null;

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Edit history for expenses (written only by the trigger).
-- ---------------------------------------------------------------------
create table if not exists public.expense_changes (
  id          bigint generated always as identity primary key,
  expense_id  uuid not null references public.expenses(id),
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now()
);
create index if not exists expense_changes_idx on public.expense_changes (expense_id, changed_at desc);

create or replace function public.log_expense_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.expense_changes (expense_id, field, new_value, changed_by)
    values (new.id, 'created', new.amount::text, auth.uid());
    return new;
  end if;
  foreach f in array array['expense_date', 'category_id', 'description', 'amount', 'payment_method', 'vendor',
                           'reference_no', 'receipt_path', 'notes', 'status', 'void_reason'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.expense_changes (expense_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists expenses_log_change on public.expenses;
create trigger expenses_log_change after insert or update on public.expenses
  for each row execute function public.log_expense_change();

-- ---------------------------------------------------------------------
-- 5. void_expense: the only way to cancel an expense. Keeps the row.
-- ---------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void expenses';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void an expense';
  end if;
  update public.expenses
     set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_expense_id and status = 'recorded';
  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end $$;
revoke all on function public.void_expense(uuid, text) from public, anon;
grant execute on function public.void_expense(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Row level security: admins only. No deletes for anyone.
-- ---------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses           enable row level security;
alter table public.expense_changes    enable row level security;

drop policy if exists "expense categories admin read"   on public.expense_categories;
drop policy if exists "expense categories admin insert" on public.expense_categories;
drop policy if exists "expense categories admin update" on public.expense_categories;
create policy "expense categories admin read"   on public.expense_categories for select to authenticated using (public.is_admin());
create policy "expense categories admin insert" on public.expense_categories for insert to authenticated with check (public.is_admin());
create policy "expense categories admin update" on public.expense_categories for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bills admin read"   on public.recurring_expenses;
drop policy if exists "bills admin insert" on public.recurring_expenses;
drop policy if exists "bills admin update" on public.recurring_expenses;
create policy "bills admin read"   on public.recurring_expenses for select to authenticated using (public.is_admin());
create policy "bills admin insert" on public.recurring_expenses for insert to authenticated with check (public.is_admin());
create policy "bills admin update" on public.recurring_expenses for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "expenses admin read"   on public.expenses;
drop policy if exists "expenses admin insert" on public.expenses;
drop policy if exists "expenses admin update" on public.expenses;
create policy "expenses admin read"   on public.expenses for select to authenticated using (public.is_admin());
create policy "expenses admin insert" on public.expenses for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid() and status = 'recorded');
create policy "expenses admin update" on public.expenses for update to authenticated
  using (public.is_admin() and status = 'recorded') with check (public.is_admin());

drop policy if exists "expense changes admin read" on public.expense_changes;
create policy "expense changes admin read" on public.expense_changes for select to authenticated using (public.is_admin());

-- Voiding only through void_expense; who created a row can't be rewritten.
revoke insert, update, delete on public.expenses from authenticated, anon;
grant insert (expense_date, category_id, description, amount, payment_method, vendor, reference_no, receipt_path, notes, recurring_id, for_month)
  on public.expenses to authenticated;
grant update (expense_date, category_id, description, amount, payment_method, vendor, reference_no, receipt_path, notes)
  on public.expenses to authenticated;
revoke delete on public.expense_categories, public.recurring_expenses, public.expense_changes from authenticated, anon;

-- ---------------------------------------------------------------------
-- 7. Receipt files: private bucket, admins only, images or PDF up to 10 MB.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts admin read"   on storage.objects;
drop policy if exists "receipts admin upload" on storage.objects;
create policy "receipts admin read"   on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_admin());
create policy "receipts admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.is_admin());

-- ---------------------------------------------------------------------
-- 8. sales_report now also returns expenses and net profit.
-- New keys: expenses { total, previous, by_category }, and each daily
-- row gains 'expenses'. Net profit = gross profit - expenses.
-- ---------------------------------------------------------------------
create or replace function public.sales_report(p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_days integer;
  v      jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view reports';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a valid date range';
  end if;
  v_days := p_to - p_from + 1;
  if v_days > 732 then
    raise exception 'Pick a range of two years or less';
  end if;

  with
  s as (
    select * from public.v_sale_totals where sale_date between p_from and p_to
  ),
  done as (
    select * from s where status = 'completed'
  ),
  prev as (
    select * from public.v_sale_totals
     where status = 'completed' and sale_date between p_from - v_days and p_from - 1
  ),
  li as (
    select si.product_id, si.product_code, si.product_name, si.qty, si.line_total, si.line_profit,
           p.category, p.kind, d.sale_date, d.staff_id
      from public.sale_items si
      join done d on d.id = si.sale_id
      join public.products p on p.id = si.product_id
  ),
  ex as (
    select e.expense_date, e.amount, c.name as category
      from public.expenses e join public.expense_categories c on c.id = e.category_id
     where e.status = 'recorded' and e.expense_date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'revenue', coalesce(sum(total), 0), 'cost', coalesce(sum(cost), 0), 'gross_profit', coalesce(sum(gross_profit), 0),
        'receipts', count(*), 'items', coalesce(sum(items_count), 0), 'discounts', coalesce(sum(discount), 0))
      from done),
    'previous', (
      select jsonb_build_object(
        'revenue', coalesce(sum(total), 0), 'gross_profit', coalesce(sum(gross_profit), 0),
        'receipts', count(*), 'items', coalesce(sum(items_count), 0))
      from prev),
    'expenses', jsonb_build_object(
      'total', (select coalesce(sum(amount), 0) from ex),
      'previous', (select coalesce(sum(amount), 0) from public.expenses
                    where status = 'recorded' and expense_date between p_from - v_days and p_from - 1),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t) order by t desc), '[]'::jsonb)
                        from (select category, sum(amount) as t from ex group by category) q)),
    'voids', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)) from s where status = 'voided'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', g.d::date, 'revenue', coalesce(x.revenue, 0), 'profit', coalesce(x.profit, 0),
               'receipts', coalesce(x.receipts, 0), 'expenses', coalesce(y.spent, 0))
             order by g.d), '[]'::jsonb)
        from generate_series(p_from, p_to, interval '1 day') as g(d)
        left join (select sale_date, sum(total) as revenue, sum(gross_profit) as profit, count(*) as receipts
                     from done group by sale_date) x on x.sale_date = g.d::date
        left join (select expense_date, sum(amount) as spent from ex group by expense_date) y on y.expense_date = g.d::date),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('method', payment_method, 'total', t, 'receipts', n) order by t desc), '[]'::jsonb)
        from (select payment_method, sum(total) as t, count(*) as n from done group by payment_method) q),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'receipts', n, 'revenue', r)), '[]'::jsonb)
        from (select extract(dow from sold_at_local)::int as dow, extract(hour from sold_at_local)::int as hr,
                     count(*) as n, sum(total) as r
                from done group by 1, 2) q),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('category', category, 'revenue', r, 'profit', pr, 'units', u) order by r desc), '[]'::jsonb)
        from (select category, sum(line_total) as r, sum(line_profit) as pr, sum(qty) as u from li group by category) q),
    'category_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', sale_date, 'category', category, 'revenue', r, 'units', u)), '[]'::jsonb)
        from (select sale_date, category, sum(line_total) as r, sum(qty) as u from li group by sale_date, category) q),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', product_id, 'code', product_code, 'name', product_name, 'category', category, 'kind', kind,
               'units', u, 'revenue', r, 'profit', pr) order by r desc), '[]'::jsonb)
        from (select product_id, product_code, product_name, category, kind,
                     sum(qty) as u, sum(line_total) as r, sum(line_profit) as pr
                from li group by product_id, product_code, product_name, category, kind) q),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'staff_id', staff_id, 'name', name, 'role', role, 'receipts', n, 'revenue', r, 'profit', pr,
               'items', it, 'discounts', dc, 'memberships', m) order by r desc), '[]'::jsonb)
        from (select d.staff_id, coalesce(pf.full_name, 'Unknown') as name, pf.role,
                     count(*) as n, sum(d.total) as r, sum(d.gross_profit) as pr, sum(d.items_count) as it, sum(d.discount) as dc,
                     coalesce((select sum(qty) from li where li.staff_id = d.staff_id and li.category = 'Membership'), 0) as m
                from done d left join public.profiles pf on pf.id = d.staff_id
               group by d.staff_id, pf.full_name, pf.role) q),
    'staff_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', sale_date, 'staff_id', staff_id, 'revenue', r, 'receipts', n)), '[]'::jsonb)
        from (select sale_date, staff_id, sum(total) as r, count(*) as n from done group by sale_date, staff_id) q)
  ) into v;

  return v;
end $$;

revoke all on function public.sales_report(date, date) from public, anon;
grant execute on function public.sales_report(date, date) to authenticated;

-- Tell the Supabase API about new or changed functions right away.
notify pgrst, 'reload schema';
