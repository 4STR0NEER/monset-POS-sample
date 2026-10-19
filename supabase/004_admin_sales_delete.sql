-- =====================================================================
-- 004  Sales are admin-only, and admins can delete products.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Only admins can read sales. Staff can read just the receipts they
-- rang up themselves, which the register needs to show the receipt
-- right after checkout. Reports were already admin-only (sales_report).
-- ---------------------------------------------------------------------
drop policy if exists "sales read" on public.sales;
create policy "sales read" on public.sales for select to authenticated
  using (public.is_admin() or (public.is_staff() and staff_id = auth.uid()));

drop policy if exists "sale items read" on public.sale_items;
create policy "sale items read" on public.sale_items for select to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and exists (select 1 from public.sales s where s.id = sale_id and s.staff_id = auth.uid()))
  );

-- ---------------------------------------------------------------------
-- 2. delete_product (admin only).
-- Never sold: removed completely, with its stock history.
-- Sold before: removed from Inventory and the register but kept in the
-- database, so old receipts and reports stay correct. Its code is freed
-- so a new product can use it.
-- Returns 'deleted' or 'archived'.
-- ---------------------------------------------------------------------
alter table public.products add column if not exists deleted_at timestamptz;

create or replace function public.delete_product(p_product_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete products';
  end if;

  perform 1 from public.products where id = p_product_id and deleted_at is null for update;
  if not found then
    raise exception 'Product not found';
  end if;

  if exists (select 1 from public.sale_items where product_id = p_product_id) then
    update public.products
       set is_active = false,
           deleted_at = now(),
           code = left(code, 40) || ' (deleted ' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') || ')'
     where id = p_product_id;
    return 'archived';
  end if;

  delete from public.stock_movements where product_id = p_product_id;
  delete from public.products where id = p_product_id;
  return 'deleted';
end $$;

revoke all on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;

-- Tell the Supabase API about new or changed functions right away.
notify pgrst, 'reload schema';
