-- =====================================================================
-- 007  Payroll. Admin only. Safe to re-run.
-- Employees (separate from POS logins), editable contribution and tax
-- rates with effective dates, pay runs (draft -> finalized -> voided).
-- Finalizing posts the run into Expenses so net profit includes it.
-- The payslip arithmetic lives in src/lib/payroll.js (tested); each
-- payslip stores its numbers and the run stores the rates it used.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employees
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id                      uuid primary key default gen_random_uuid(),
  full_name               text not null check (length(trim(full_name)) > 0),
  position                text,
  profile_id              uuid references public.profiles(id),   -- optional link to a POS login
  pay_frequency           text not null default 'semi_monthly' check (pay_frequency in ('weekly', 'semi_monthly', 'monthly')),
  pay_basis               text not null default 'monthly' check (pay_basis in ('monthly', 'daily', 'hourly')),
  rate                    numeric(12,2) not null check (rate >= 0), -- monthly salary, daily rate or hourly rate
  contributions_enabled   boolean not null default true,          -- SSS, PhilHealth, Pag-IBIG
  minimum_wage_earner     boolean not null default false,         -- exempt from withholding tax
  sss_no                  text,
  philhealth_no           text,
  pagibig_no              text,
  tin                     text,
  start_date              date,
  is_active               boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
drop trigger if exists employees_updated_at on public.employees;
create trigger employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

create table if not exists public.employee_changes (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id),
  field        text not null,
  old_value    text,
  new_value    text,
  changed_by   uuid references auth.users(id),
  changed_at   timestamptz not null default now()
);

create or replace function public.log_employee_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.employee_changes (employee_id, field, new_value, changed_by) values (new.id, 'created', new.full_name, auth.uid());
    return new;
  end if;
  foreach f in array array['full_name', 'position', 'profile_id', 'pay_frequency', 'pay_basis', 'rate', 'contributions_enabled',
                           'minimum_wage_earner', 'sss_no', 'philhealth_no', 'pagibig_no', 'tin', 'start_date', 'is_active'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.employee_changes (employee_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists employees_log_change on public.employees;
create trigger employees_log_change after insert or update on public.employees
  for each row execute function public.log_employee_change();

-- ---------------------------------------------------------------------
-- 2. Rates. A new version is added with the date it applies from; old
-- versions stay so past payslips can be explained.
-- kind: sss | philhealth | pagibig | tax.  config: see src/lib/payroll.js
-- ---------------------------------------------------------------------
create table if not exists public.payroll_rates (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('sss', 'philhealth', 'pagibig', 'tax')),
  effective_from  date not null,
  config          jsonb not null,
  notes           text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (kind, effective_from)
);

-- Starting values as published for 2025. CONFIRM WITH YOUR ACCOUNTANT before the first payroll.
insert into public.payroll_rates (kind, effective_from, config, notes) values
  ('sss', '2025-01-01',
   '{"ee_rate":0.05,"er_rate":0.10,"msc_min":5000,"msc_max":35000,"msc_step":500,"ec_low":10,"ec_high":30,"ec_threshold":15000}',
   'SSS 2025: 15% of monthly salary credit (employer 10%, employee 5%), MSC 5,000 to 35,000 in 500 steps; EC 10 below MSC 15,000, else 30. Verify.'),
  ('philhealth', '2025-01-01',
   '{"rate":0.05,"ee_share":0.5,"floor":10000,"ceiling":100000}',
   'PhilHealth 2025: 5% of monthly basic salary, floor 10,000, ceiling 100,000, split equally. Verify.'),
  ('pagibig', '2024-02-01',
   '{"ee_rate":0.02,"ee_rate_low":0.01,"low_threshold":1500,"er_rate":0.02,"max_fund_salary":10000}',
   'Pag-IBIG from Feb 2024: 2% each (employee 1% if pay is 1,500 or less), on up to 10,000 a month. Verify.'),
  ('tax', '2023-01-01',
   '{"period":"monthly","brackets":[{"over":0,"base":0,"rate":0},{"over":20833,"base":0,"rate":0.15},{"over":33333,"base":1875,"rate":0.20},{"over":66667,"base":8541.80,"rate":0.25},{"over":166667,"base":33541.80,"rate":0.30},{"over":666667,"base":183541.80,"rate":0.35}]}',
   'BIR withholding tax on compensation, monthly table (TRAIN, 2023 onwards). Verify.')
on conflict (kind, effective_from) do nothing;

-- ---------------------------------------------------------------------
-- 3. Pay runs and payslips
-- ---------------------------------------------------------------------
create table if not exists public.payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  pay_frequency   text not null check (pay_frequency in ('weekly', 'semi_monthly', 'monthly')),
  period_start    date not null,
  period_end      date not null check (period_end >= period_start),
  pay_date        date not null,
  status          text not null default 'draft' check (status in ('draft', 'finalized', 'voided')),
  rates           jsonb,          -- the rate versions used, copied in at finalize
  notes           text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  finalized_by    uuid references auth.users(id),
  finalized_at    timestamptz,
  voided_by       uuid references auth.users(id),
  voided_at       timestamptz,
  void_reason     text
);
create index if not exists payroll_runs_pay_date_idx on public.payroll_runs (pay_date);

create table if not exists public.payroll_items (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id             uuid not null references public.employees(id),
  employee_name           text not null,      -- copied so old payslips keep the name used then
  pay_basis               text not null,
  rate                    numeric(12,2) not null,
  days_worked             numeric(6,2),
  hours_worked            numeric(7,2),
  basic_pay               numeric(12,2) not null default 0 check (basic_pay >= 0),
  overtime_pay            numeric(12,2) not null default 0 check (overtime_pay >= 0),
  allowances_taxable      numeric(12,2) not null default 0 check (allowances_taxable >= 0),
  allowances_nontaxable   numeric(12,2) not null default 0 check (allowances_nontaxable >= 0),
  other_deductions        numeric(12,2) not null default 0 check (other_deductions >= 0),
  deductions_note         text,
  gross_pay               numeric(12,2) not null default 0,
  sss_ee                  numeric(12,2) not null default 0,
  sss_er                  numeric(12,2) not null default 0,
  sss_ec                  numeric(12,2) not null default 0,
  philhealth_ee           numeric(12,2) not null default 0,
  philhealth_er           numeric(12,2) not null default 0,
  pagibig_ee              numeric(12,2) not null default 0,
  pagibig_er              numeric(12,2) not null default 0,
  taxable_income          numeric(12,2) not null default 0,
  withholding_tax         numeric(12,2) not null default 0,
  net_pay                 numeric(12,2) not null default 0,
  unique (run_id, employee_id)
);
create index if not exists payroll_items_employee_idx on public.payroll_items (employee_id);

-- Payroll postings in Expenses point back to their run and can't be edited there.
alter table public.expenses add column if not exists payroll_run_id uuid references public.payroll_runs(id);

-- ---------------------------------------------------------------------
-- 4. Finalize: lock the run, keep the rates used, post to Expenses.
-- ---------------------------------------------------------------------
create or replace function public.finalize_payroll(p_run_id uuid, p_rates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        public.payroll_runs%rowtype;
  v_gross  numeric;
  v_er     numeric;
  v_n      integer;
  v_label  text;
  v_cat_pay uuid;
  v_cat_gov uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can finalize payroll';
  end if;
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'Pay run not found';
  end if;
  if r.status <> 'draft' then
    raise exception 'This pay run is already %', r.status;
  end if;

  select count(*), coalesce(sum(gross_pay), 0), coalesce(sum(sss_er + sss_ec + philhealth_er + pagibig_er), 0)
    into v_n, v_gross, v_er
    from public.payroll_items where run_id = p_run_id;
  if v_n = 0 then
    raise exception 'Add at least one employee before finalizing';
  end if;
  if exists (select 1 from public.payroll_items where run_id = p_run_id and net_pay < 0) then
    raise exception 'A payslip has a negative net pay; fix the deductions first';
  end if;

  update public.payroll_runs
     set status = 'finalized', rates = p_rates, finalized_by = auth.uid(), finalized_at = now()
   where id = p_run_id;

  insert into public.expense_categories (name) values ('Payroll'), ('Government contributions') on conflict (name) do nothing;
  select id into v_cat_pay from public.expense_categories where name = 'Payroll';
  select id into v_cat_gov from public.expense_categories where name = 'Government contributions';
  v_label := to_char(r.period_start, 'Mon DD') || ' – ' || to_char(r.period_end, 'Mon DD, YYYY');

  insert into public.expenses (expense_date, category_id, description, amount, payment_method, payroll_run_id, created_by)
  values (r.pay_date, v_cat_pay, 'Salaries & wages, ' || v_label || ' (' || v_n || ' staff)', v_gross, 'cash', p_run_id, auth.uid());
  if v_er > 0 then
    insert into public.expenses (expense_date, category_id, description, amount, payment_method, payroll_run_id, created_by)
    values (r.pay_date, v_cat_gov, 'Employer SSS, PhilHealth & Pag-IBIG, ' || v_label, v_er, 'other', p_run_id, auth.uid());
  end if;
end $$;
revoke all on function public.finalize_payroll(uuid, jsonb) from public, anon;
grant execute on function public.finalize_payroll(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Void a finalized run (with reason); its expenses are voided too.
-- ---------------------------------------------------------------------
create or replace function public.void_payroll_run(p_run_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void payroll';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a pay run';
  end if;
  update public.payroll_runs
     set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where id = p_run_id and status = 'finalized';
  if not found then
    raise exception 'Only a finalized pay run can be voided (delete a draft instead)';
  end if;
  update public.expenses
     set status = 'voided', void_reason = 'Pay run voided: ' || trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where payroll_run_id = p_run_id and status = 'recorded';
end $$;
revoke all on function public.void_payroll_run(uuid, text) from public, anon;
grant execute on function public.void_payroll_run(uuid, text) to authenticated;

-- Manual voids and edits in Expenses skip payroll postings.
create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can void expenses';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void an expense';
  end if;
  if exists (select 1 from public.expenses where id = p_expense_id and payroll_run_id is not null) then
    raise exception 'This comes from a pay run; void the pay run in Payroll instead';
  end if;
  update public.expenses
     set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_expense_id and status = 'recorded';
  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end $$;

drop policy if exists "expenses admin update" on public.expenses;
create policy "expenses admin update" on public.expenses for update to authenticated
  using (public.is_admin() and status = 'recorded' and payroll_run_id is null) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Row level security: admins only. Drafts are editable and can be
-- deleted; finalized and voided runs are locked.
-- ---------------------------------------------------------------------
alter table public.employees        enable row level security;
alter table public.employee_changes enable row level security;
alter table public.payroll_rates    enable row level security;
alter table public.payroll_runs     enable row level security;
alter table public.payroll_items    enable row level security;

drop policy if exists "employees admin read"   on public.employees;
drop policy if exists "employees admin insert" on public.employees;
drop policy if exists "employees admin update" on public.employees;
create policy "employees admin read"   on public.employees for select to authenticated using (public.is_admin());
create policy "employees admin insert" on public.employees for insert to authenticated with check (public.is_admin());
create policy "employees admin update" on public.employees for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "employee changes admin read" on public.employee_changes;
create policy "employee changes admin read" on public.employee_changes for select to authenticated using (public.is_admin());

drop policy if exists "rates admin read"   on public.payroll_rates;
drop policy if exists "rates admin insert" on public.payroll_rates;
create policy "rates admin read"   on public.payroll_rates for select to authenticated using (public.is_admin());
create policy "rates admin insert" on public.payroll_rates for insert to authenticated with check (public.is_admin() and created_by = auth.uid());

drop policy if exists "runs admin read"   on public.payroll_runs;
drop policy if exists "runs admin insert" on public.payroll_runs;
drop policy if exists "runs admin update" on public.payroll_runs;
drop policy if exists "runs admin delete" on public.payroll_runs;
create policy "runs admin read"   on public.payroll_runs for select to authenticated using (public.is_admin());
create policy "runs admin insert" on public.payroll_runs for insert to authenticated with check (public.is_admin() and status = 'draft' and created_by = auth.uid());
create policy "runs admin update" on public.payroll_runs for update to authenticated using (public.is_admin() and status = 'draft') with check (public.is_admin() and status = 'draft');
create policy "runs admin delete" on public.payroll_runs for delete to authenticated using (public.is_admin() and status = 'draft');

drop policy if exists "items admin read"   on public.payroll_items;
drop policy if exists "items admin write"  on public.payroll_items;
create policy "items admin read"  on public.payroll_items for select to authenticated using (public.is_admin());
create policy "items admin write" on public.payroll_items for all to authenticated
  using (public.is_admin() and exists (select 1 from public.payroll_runs r where r.id = run_id and r.status = 'draft'))
  with check (public.is_admin() and exists (select 1 from public.payroll_runs r where r.id = run_id and r.status = 'draft'));

-- Status changes only through finalize_payroll / void_payroll_run; rate versions are never edited or deleted.
revoke update on public.payroll_runs from authenticated, anon;
grant update (pay_frequency, period_start, period_end, pay_date, notes) on public.payroll_runs to authenticated;
revoke update, delete on public.payroll_rates, public.employee_changes from authenticated, anon;
revoke delete on public.employees from authenticated, anon;

-- Tell the Supabase API about new or changed functions right away.
notify pgrst, 'reload schema';
