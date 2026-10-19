// npm run test:pdf — builds both PDFs from small samples and checks the money formatting.
import assert from 'node:assert/strict'
import { amt, payslipsPdf, salesReportPdf } from './pdf.js'

let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)

assert.equal(amt(1234.5), '1,234.50')
assert.equal(amt(-16460), '(16,460.00)')
assert.equal(amt('0'), '0.00')
assert.equal(amt(0.005), '0.01'); ok('amounts use two decimals and accounting brackets for negatives')

const r = {
  from: '2026-10-01', to: '2026-10-31',
  totals: { revenue: 1000, gross_profit: 400, receipts: 10, items: 12, discounts: 0 },
  previous: { revenue: 800, gross_profit: 300, receipts: 9, items: 10 },
  expenses: { total: 650, previous: 0, by_category: [{ category: 'Rent', total: 650 }] },
  voids: { count: 0, total: 0 },
  daily: [], payments: [{ method: 'cash', total: 1000, receipts: 10 }],
  categories: [{ category: 'Drinks', revenue: 1000, profit: 400, units: 12 }],
  products: [{ product_id: 'x', name: 'Pocari – 500ml', category: 'Drinks', units: 12, revenue: 1000, profit: 400 }],
  staff: [{ name: 'José Rizal', receipts: 10, revenue: 1000, memberships: 0, discounts: 0 }],
}
const doc = salesReportPdf({ r, label: 'October 2026', expenses: [{ expense_date: '2026-10-05', description: 'Rent', category: 'Rent', amount: 650, payment_method: 'cash' }] })
assert.ok(doc.getNumberOfPages() >= 1)
assert.ok(doc.output('arraybuffer').byteLength > 5000); ok('sales report builds (net loss, en dash and accented names are safe)')

const items = [{ employee_id: 'a', employee_name: 'Coach Karl', pay_basis: 'monthly', rate: 20000, basic_pay: 10000, overtime_pay: 0, allowances_taxable: 0, allowances_nontaxable: 0, other_deductions: 0, gross_pay: 10000, sss_ee: 500, sss_er: 1000, sss_ec: 10, philhealth_ee: 250, philhealth_er: 250, pagibig_ee: 200, pagibig_er: 200, taxable_income: 9050, withholding_tax: 0, net_pay: 9050 }]
const slips = payslipsPdf({ run: { period_start: '2026-10-01', period_end: '2026-10-15', pay_date: '2026-10-15', status: 'draft' }, items })
assert.equal(slips.getNumberOfPages(), 2); ok('payslips: a summary page plus one page per employee')
console.log('all passed')
