// Gathers the data for each PDF and downloads it. The PDF code (jsPDF) is loaded on first
// use only, so the register tablet never downloads it.
import { supabase } from './supabase.js'
import { manilaToday } from './util.js'
import { addDays, monthStart } from '../components/RangePicker.jsx'

const loadPdf = () => import('./pdf.js')

// Supabase returns at most 1,000 rows per request; page through so a long range is complete.
async function fetchAll(query) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

// Ready-made report periods (Manila dates). Weeks run Monday to Sunday.
export function reportPeriods(custom) {
  const t = manilaToday()
  const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7
  const weekStart = addDays(t, -dow)
  const lmEnd = addDays(monthStart(t), -1)
  const fmt = (d, o) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })
  const span = (a, b) => `${fmt(a, { month: 'short', day: 'numeric' })} - ${fmt(b, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const list = [
    ['week', 'This week', weekStart, t, `Week of ${span(weekStart, t)}`],
    ['lastweek', 'Last week', addDays(weekStart, -7), addDays(weekStart, -1), `Week of ${span(addDays(weekStart, -7), addDays(weekStart, -1))}`],
    ['month', 'This month', monthStart(t), t, `${fmt(t, { month: 'long', year: 'numeric' })} (to ${fmt(t, { month: 'short', day: 'numeric' })})`],
    ['lastmonth', 'Last month', monthStart(lmEnd), lmEnd, fmt(lmEnd, { month: 'long', year: 'numeric' })],
  ]
  if (custom) list.push(['custom', 'Dates shown on screen', custom.from, custom.to, span(custom.from, custom.to)])
  return list
}

export async function downloadSalesReport({ from, to, label, by }) {
  const [{ salesReportPdf }, rep, expenses, payroll] = await Promise.all([
    loadPdf(),
    supabase.rpc('sales_report', { p_from: from, p_to: to }),
    fetchAll(() =>
      supabase
        .from('expenses')
        .select('expense_date, description, vendor, reference_no, payment_method, amount, expense_categories(name)')
        .eq('status', 'recorded')
        .gte('expense_date', from)
        .lte('expense_date', to)
        .order('expense_date')
        .order('created_at'),
    ).catch(() => []), // before patch 006 there is no expenses table
    supabase.from('payroll_runs').select('*, payroll_items(*)').eq('status', 'finalized').gte('pay_date', from).lte('pay_date', to).order('pay_date'),
  ])
  if (rep.error) throw rep.error
  const doc = salesReportPdf({
    r: rep.data,
    label,
    expenses: expenses.map((e) => ({ ...e, category: e.expense_categories?.name ?? '' })),
    payroll: payroll.error ? [] : payroll.data,
    by,
  })
  doc.save(`report_${from}_to_${to}.pdf`)
}

export async function downloadPayslips({ run, items, employees, by }) {
  const { payslipsPdf } = await loadPdf()
  const doc = payslipsPdf({ run, items, employees, by })
  doc.save(`payroll_${run.period_start}_to_${run.period_end}${run.status === 'finalized' ? '' : '_DRAFT'}.pdf`)
}
