// npm run test:payroll — worked examples for the payroll arithmetic (2025 rate seeds).
import assert from 'node:assert/strict'
import { EMPTY_PRIOR, addToPrior, computePayslip, pagibig, philhealth, ratesOn, sss, suggestedBasic, withholding } from './payroll.js'

const rates = {
  sss: { ee_rate: 0.05, er_rate: 0.1, msc_min: 5000, msc_max: 35000, msc_step: 500, ec_low: 10, ec_high: 30, ec_threshold: 15000 },
  philhealth: { rate: 0.05, ee_share: 0.5, floor: 10000, ceiling: 100000 },
  pagibig: { ee_rate: 0.02, ee_rate_low: 0.01, low_threshold: 1500, er_rate: 0.02, max_fund_salary: 10000 },
  tax: { brackets: [{ over: 0, base: 0, rate: 0 }, { over: 20833, base: 0, rate: 0.15 }, { over: 33333, base: 1875, rate: 0.2 }, { over: 66667, base: 8541.8, rate: 0.25 }, { over: 166667, base: 33541.8, rate: 0.3 }, { over: 666667, base: 183541.8, rate: 0.35 }] },
}
let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)

// SSS salary credit brackets
assert.deepEqual(sss(4000, rates.sss), { msc: 5000, ee: 250, er: 500, ec: 10 })
assert.equal(sss(5249.99, rates.sss).msc, 5000)
assert.equal(sss(5250, rates.sss).msc, 5500)
assert.deepEqual(sss(14749.99, rates.sss), { msc: 14500, ee: 725, er: 1450, ec: 10 })
assert.deepEqual(sss(14750, rates.sss), { msc: 15000, ee: 750, er: 1500, ec: 30 })
assert.equal(sss(100000, rates.sss).msc, 35000)
assert.deepEqual(sss(0, rates.sss), { msc: 0, ee: 0, er: 0, ec: 0 }); ok('SSS salary credit: floor 5,000, 500 steps, cap 35,000, EC 10/30')

assert.deepEqual(philhealth(8000, rates.philhealth), { ee: 250, er: 250 })
assert.deepEqual(philhealth(25000, rates.philhealth), { ee: 625, er: 625 })
assert.deepEqual(philhealth(150000, rates.philhealth), { ee: 2500, er: 2500 }); ok('PhilHealth 5% between floor 10,000 and ceiling 100,000, split equally')

assert.deepEqual(pagibig(1500, rates.pagibig), { ee: 15, er: 30 })
assert.deepEqual(pagibig(8000, rates.pagibig), { ee: 160, er: 160 })
assert.deepEqual(pagibig(40000, rates.pagibig), { ee: 200, er: 200 }); ok('Pag-IBIG 2% (1% at 1,500 or less), capped at 10,000')

assert.equal(withholding(20833, rates.tax), 0)
assert.equal(withholding(25000, rates.tax), 625.05)
assert.equal(withholding(37050, rates.tax), 2618.4)
assert.equal(withholding(100000, rates.tax), 16875.05); ok('BIR monthly table at bracket edges and inside brackets')

const emp = (o) => ({ rate: 20000, pay_basis: 'monthly', pay_frequency: 'semi_monthly', contributions_enabled: true, minimum_wage_earner: false, ...o })
assert.equal(suggestedBasic(emp({})), 10000)
assert.equal(suggestedBasic(emp({ pay_frequency: 'weekly' })), 4615.38)
assert.equal(suggestedBasic(emp({ pay_basis: 'daily', rate: 610 }), { days: 13 }), 7930)
assert.equal(suggestedBasic(emp({ pay_basis: 'hourly', rate: 80.5 }), { hours: 10 }), 805); ok('suggested basic pay for monthly, weekly, daily and hourly')

// Semi-monthly ₱20,000: two payouts must add up to the monthly obligations.
const e20 = emp({})
const first = computePayslip({ basic_pay: 10000 }, e20, rates)
const second = computePayslip({ basic_pay: 10000 }, e20, rates, addToPrior(EMPTY_PRIOR, first))
const both = (k) => first[k] + second[k]
assert.equal(both('sss_ee'), 1000); assert.equal(both('sss_er'), 2000); assert.equal(both('sss_ec'), 30)
assert.equal(both('philhealth_ee'), 500); assert.equal(both('philhealth_er'), 500)
assert.equal(both('pagibig_ee'), 200); assert.equal(both('pagibig_er'), 200)
assert.equal(both('withholding_tax'), 0)
assert.equal(both('net_pay'), 20000 - 1000 - 500 - 200); ok('semi-monthly ₱20,000: month totals SSS 1,000/2,030, PhilHealth 500/500, Pag-IBIG 200/200, no tax')

// Monthly ₱40,000 in one payout.
const m = computePayslip({ basic_pay: 40000 }, emp({ rate: 40000, pay_frequency: 'monthly' }), rates)
assert.equal(m.sss_ee, 1750); assert.equal(m.sss_er, 3500); assert.equal(m.philhealth_ee, 1000); assert.equal(m.pagibig_ee, 200)
assert.equal(m.taxable_income, 37050); assert.equal(m.withholding_tax, 2618.4); assert.equal(m.net_pay, 40000 - 1750 - 1000 - 200 - 2618.4); ok('monthly ₱40,000: taxable 37,050, tax 2,618.40, net 34,431.60')

// Same ₱40,000 paid semi-monthly gives the same month totals.
const a = computePayslip({ basic_pay: 20000 }, emp({ rate: 40000 }), rates)
const b = computePayslip({ basic_pay: 20000 }, emp({ rate: 40000 }), rates, addToPrior(EMPTY_PRIOR, a))
for (const k of ['sss_ee', 'sss_er', 'philhealth_ee', 'pagibig_ee', 'withholding_tax', 'net_pay']) assert.equal(round(a[k] + b[k]), m[k], k)
ok('₱40,000 paid in two halves matches the single monthly payslip exactly')

// Weekly daily-rated staff: four weeks sum to the monthly figure for the month's total pay.
const daily = emp({ pay_basis: 'daily', pay_frequency: 'weekly', rate: 650 })
let prior = EMPTY_PRIOR
const weeks = [6, 6, 5, 6].map((d) => {
  const p = computePayslip({ basic_pay: suggestedBasic(daily, { days: d }) }, daily, rates, prior)
  prior = addToPrior(prior, p)
  return p
})
const monthPay = 650 * 23
const S = sss(monthPay, rates.sss)
assert.equal(round(weeks.reduce((t, w) => t + w.sss_ee, 0)), S.ee)
assert.equal(round(weeks.reduce((t, w) => t + w.philhealth_ee, 0)), philhealth(monthPay, rates.philhealth).ee); ok('weekly daily-rated staff: month totals equal the monthly obligation')

const mwe = computePayslip({ basic_pay: 40000 }, emp({ rate: 40000, pay_frequency: 'monthly', minimum_wage_earner: true }), rates)
assert.equal(mwe.withholding_tax, 0); ok('minimum wage earners are not taxed')
const contractor = computePayslip({ basic_pay: 10000 }, emp({ contributions_enabled: false }), rates)
assert.equal(contractor.sss_ee + contractor.philhealth_ee + contractor.pagibig_ee, 0); ok('contributions can be switched off per person')

const extras = computePayslip({ basic_pay: 10000, overtime_pay: 1000, allowances_taxable: 500, allowances_nontaxable: 2000, other_deductions: 300 }, emp({ pay_frequency: 'monthly' }), rates)
assert.equal(extras.gross_pay, 13500)
assert.equal(extras.taxable_income, round(11500 - extras.sss_ee - extras.philhealth_ee - extras.pagibig_ee))
assert.equal(extras.net_pay, round(13500 - extras.sss_ee - extras.philhealth_ee - extras.pagibig_ee - extras.withholding_tax - 300)); ok('overtime and taxable allowances are taxed; non-taxable allowances and deductions are not')

const rows = [
  { kind: 'sss', effective_from: '2024-01-01', config: { v: 'old' } },
  { kind: 'sss', effective_from: '2025-01-01', config: { v: 'new' } },
]
assert.equal(ratesOn(rows, '2024-12-31').sss.v, 'old'); assert.equal(ratesOn(rows, '2025-01-01').sss.v, 'new'); ok('the rate version in effect on the pay date is used')
console.log('all passed')

function round(x) {
  return Math.round(x * 100) / 100
}
