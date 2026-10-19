-- =====================================================================
-- 008  GCash needs the last 4 digits of the reference number, and the
-- Sales page updates live. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. payment_ref: last 4 digits of the GCash reference, so a receipt
-- can be matched to the GCash app. Older sales stay blank.
-- ---------------------------------------------------------------------
alter table public.sales add column if not exists payment_ref text;

-- Signature changes again (new p_payment_ref), so the 001 version must go.
drop function if exists public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid);

create or replace function public.record_sale(
  p_items            jsonb,
  p_payment_method   text    default 'cash',
  p_discount         numeric default 0,
  p_amount_tendered  numeric default null,
  p_customer_name    text    default null,
  p_note             text    default null,
  p_sold_at          timestamptz default null,
  p_client_ref       uuid    default null,
  p_payment_ref      text    default null
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

  -- Retry of a checkout that already went through: hand back that sale.
  if p_client_ref is not null then
    select id into v_sale_id from public.sales where client_ref = p_client_ref;
    if found then
      return v_sale_id;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_payment_method = 'gcash' and coalesce(p_payment_ref, '') !~ '^\d{4}$' then
    raise exception 'Enter the last 4 digits of the GCash reference number';
  end if;

  insert into public.sales (sold_at, payment_method, payment_ref, discount, customer_name, note, staff_id, client_ref)
  values (v_sold_at, p_payment_method, case when p_payment_method = 'gcash' then p_payment_ref end,
          v_discount, p_customer_name, p_note, auth.uid(), p_client_ref)
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

revoke all on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.record_sale(jsonb, text, numeric, numeric, text, text, timestamptz, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Live Sales page: broadcast sales changes over Supabase Realtime.
-- Realtime still applies the "sales read" policy, so only admins (and
-- staff for their own receipts) get the events.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;

notify pgrst, 'reload schema';
