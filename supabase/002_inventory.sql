-- =====================================================================
-- 002  Inventory. Staff and admin can add and edit products and stock;
-- every change is recorded with who made it. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Team members can see each other's names (for "who changed this").
-- ---------------------------------------------------------------------
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------
-- 2. Staff and admin can add and edit products (prices, names, reorder
-- levels, hiding). stock_qty is NOT editable directly: it only moves
-- through stock_movements, so the count and its history always agree.
-- ---------------------------------------------------------------------
drop policy if exists "products admin insert" on public.products;
drop policy if exists "products admin update" on public.products;
drop policy if exists "products staff insert" on public.products;
drop policy if exists "products staff update" on public.products;
create policy "products staff insert" on public.products for insert to authenticated
  with check (public.is_staff());
create policy "products staff update" on public.products for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

revoke insert, update on public.products from authenticated, anon;
grant insert (code, name, category, kind, unit_cost, selling_price, reorder_level, is_active)
  on public.products to authenticated;
grant update (code, name, category, kind, unit_cost, selling_price, reorder_level, is_active)
  on public.products to authenticated;

-- ---------------------------------------------------------------------
-- 3. Product history: every price, cost or detail change, with who and when.
-- Written only by the trigger; nobody can edit or delete it.
-- ---------------------------------------------------------------------
create table if not exists public.product_changes (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  field       text not null,          -- 'created', 'selling_price', 'unit_cost', ...
  old_value   text,
  new_value   text,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now()
);
create index if not exists product_changes_prod_idx on public.product_changes (product_id, changed_at desc);

alter table public.product_changes enable row level security;
drop policy if exists "product changes read" on public.product_changes;
create policy "product changes read" on public.product_changes for select to authenticated
  using (public.is_staff());

create or replace function public.log_product_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
begin
  if tg_op = 'INSERT' then
    insert into public.product_changes (product_id, field, new_value, changed_by)
    values (new.id, 'created', new.name, auth.uid());
    return new;
  end if;
  foreach f in array array['name', 'code', 'category', 'kind', 'unit_cost', 'selling_price', 'reorder_level', 'is_active'] loop
    if (to_jsonb(old) ->> f) is distinct from (to_jsonb(new) ->> f) then
      insert into public.product_changes (product_id, field, old_value, new_value, changed_by)
      values (new.id, f, to_jsonb(old) ->> f, to_jsonb(new) ->> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists products_log_change on public.products;
create trigger products_log_change
  after insert or update on public.products
  for each row execute function public.log_product_change();

-- ---------------------------------------------------------------------
-- 4. Stock movements staff and admin can record by hand: deliveries,
-- spoilage and count adjustments. Sales and voids only ever come from
-- record_sale / void_sale.
-- ---------------------------------------------------------------------
drop policy if exists "stock insert" on public.stock_movements;
create policy "stock insert" on public.stock_movements for insert to authenticated
  with check (
    created_by = auth.uid()
    and sale_id is null
    and public.is_staff()
    and movement_type in ('purchase', 'spoilage', 'adjustment')
  );

-- ---------------------------------------------------------------------
-- 5. set_stock_count: "we counted 18 on the shelf". Records the
-- difference as an adjustment, worked out under a row lock so a sale
-- happening at the same moment can't throw the count off.
-- Returns the difference that was recorded (0 = count already matched).
-- ---------------------------------------------------------------------
create or replace function public.set_stock_count(p_product_id uuid, p_counted integer, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_stock integer;
  v_kind  text;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'The count must be zero or more';
  end if;

  select stock_qty, kind into v_stock, v_kind
    from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_kind <> 'good' then
    raise exception 'Services have no stock to count';
  end if;

  if p_counted <> v_stock then
    insert into public.stock_movements (product_id, movement_type, qty, note, created_by)
    values (p_product_id, 'adjustment', p_counted - v_stock,
            coalesce(nullif(trim(p_note), ''), 'Stock count: ' || v_stock || ' → ' || p_counted), auth.uid());
  end if;
  return p_counted - v_stock;
end $$;

revoke all on function public.set_stock_count(uuid, integer, text) from public, anon;
grant execute on function public.set_stock_count(uuid, integer, text) to authenticated;

-- Tell the Supabase API about new or changed functions right away.
notify pgrst, 'reload schema';
