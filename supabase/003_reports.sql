-- =====================================================================
-- 003  Analytics. One call returns everything the Analytics tabs need
-- for a date range (Manila dates), so the browser never pulls raw sales
-- rows (Supabase caps those at 1,000 per request). Admin only.
-- Safe to re-run.
-- =====================================================================

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
  -- Line items of completed sales. Line amounts are before receipt discounts.
  li as (
    select si.product_id, si.product_code, si.product_name, si.qty, si.line_total, si.line_profit,
           p.category, p.kind, d.sale_date, d.staff_id
      from public.sale_items si
      join done d on d.id = si.sale_id
      join public.products p on p.id = si.product_id
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
    'voids', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)) from s where status = 'voided'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', g.d::date, 'revenue', coalesce(x.revenue, 0), 'profit', coalesce(x.profit, 0), 'receipts', coalesce(x.receipts, 0))
             order by g.d), '[]'::jsonb)
        from generate_series(p_from, p_to, interval '1 day') as g(d)
        left join (select sale_date, sum(total) as revenue, sum(gross_profit) as profit, count(*) as receipts
                     from done group by sale_date) x on x.sale_date = g.d::date),
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
