// Philippine payroll arithmetic. Pure functions, tested in src/lib/payroll.test.mjs.
// Rates come from the payroll_rates table (editable in the app); configs look like the
// seed values in supabase/007_payroll.sql.
//
// Month-to-date method: SSS, PhilHealth, Pag-IBIG and withholding tax are monthly
// obligations. Each payslip computes them on everything paid to the employee so far this
// month (by pay date) and deducts only what hasn't been deducted yet. However often
// someone is paid, the monthly totals equal what is due for the month.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

// SSS on monthly compensation: salary credit rounded to the nearest step, within min/max.
export function sss(comp, c) {
  if (comp <= 0) return { msc: 0, ee: 0, er: 0, ec: 0 }
  const msc = clamp(Math.floor((comp + c.msc_step / 2) / c.msc_step) * c.msc_step, c.msc_min, c.msc_max)
  return { msc, ee: round2(msc * c.ee_rate), er: round2(msc * c.er_rate), ec: msc < c.ec_threshold ? c.ec_low : c.ec_high }
}

// PhilHealth on monthly basic salary, between floor and ceiling, shared by employee and employer.
export function philhealth(basic, c) {
  if (basic <= 0) return { ee: 0, er: 0 }
  const premium = round2(clamp(basic, c.floor, c.ceiling) * c.rate)
  const ee = round2(premium * c.ee_share)
  return { ee, er: round2(premium - ee) }
}

// Pag-IBIG on monthly compensation up to the maximum fund salary.
export function pagibig(comp, c) {
  if (comp <= 0) return { ee: 0, er: 0 }
  const base = Math.min(comp, c.max_fund_salary)
  return { ee: round2(base * (comp <= c.low_threshold ? c.ee_rate_low : c.ee_rate)), er: round2(base * c.er_rate) }
}

// Monthly withholding tax from the bracket table: base + rate × (taxable − over).
export function withholding(taxable, c) {
  const b = [...c.brackets].reverse().find((x) => taxable > x.over) ?? c.brackets[0]
  return Math.max(0, round2(b.base + b.rate * (taxable - b.over)))
}

const PERIODS_PER_MONTH = { monthly: 1, semi_monthly: 2, weekly: 52 / 12 }

// Suggested basic pay for one payout; the admin can overwrite it on the payslip.
export function suggestedBasic(emp, { days, hours } = {}) {
  const rate = Number(emp.rate) || 0
  if (emp.pay_basis === 'daily') return round2(rate * (Number(days) || 0))
  if (emp.pay_basis === 'hourly') return round2(rate * (Number(hours) || 0))
  return round2(rate / PERIODS_PER_MONTH[emp.pay_frequency])
}

export const EMPTY_PRIOR = { comp: 0, basic: 0, taxable: 0, sss_ee: 0, sss_er: 0, sss_ec: 0, philhealth_ee: 0, philhealth_er: 0, pagibig_ee: 0, pagibig_er: 0, withholding_tax: 0 }

// Adds a finalized payslip into the month-to-date totals used as `prior`.
export function addToPrior(prior, it) {
  const comp = Number(it.basic_pay) + Number(it.overtime_pay) + Number(it.allowances_taxable)
  const out = { ...prior, comp: prior.comp + comp, basic: prior.basic + Number(it.basic_pay), taxable: prior.taxable + Number(it.taxable_income) }
  for (const k of ['sss_ee', 'sss_er', 'sss_ec', 'philhealth_ee', 'philhealth_er', 'pagibig_ee', 'pagibig_er', 'withholding_tax']) out[k] = prior[k] + Number(it[k])
  return out
}

// One payslip. `inp` = what the admin entered; `prior` = this employee's earlier finalized
// payslips in the same month. Returns every stored payslip number.
export function computePayslip(inp, emp, rates, prior = EMPTY_PRIOR) {
  const n = (v) => round2(Number(v) || 0)
  const basic = n(inp.basic_pay)
  const ot = n(inp.overtime_pay)
  const allowT = n(inp.allowances_taxable)
  const allowN = n(inp.allowances_nontaxable)
  const other = n(inp.other_deductions)
  const comp = round2(basic + ot + allowT) // compensation subject to contributions and tax
  const gross = round2(comp + allowN)

  let s = { ee: 0, er: 0, ec: 0 }
  let ph = { ee: 0, er: 0 }
  let pi = { ee: 0, er: 0 }
  if (emp.contributions_enabled) {
    const due = (total, already) => Math.max(0, round2(total - already))
    const S = sss(prior.comp + comp, rates.sss)
    s = { ee: due(S.ee, prior.sss_ee), er: due(S.er, prior.sss_er), ec: due(S.ec, prior.sss_ec) }
    const P = philhealth(prior.basic + basic, rates.philhealth)
    ph = { ee: due(P.ee, prior.philhealth_ee), er: due(P.er, prior.philhealth_er) }
    const G = pagibig(prior.comp + comp, rates.pagibig)
    pi = { ee: due(G.ee, prior.pagibig_ee), er: due(G.er, prior.pagibig_er) }
  }
  const taxable = Math.max(0, round2(comp - s.ee - ph.ee - pi.ee))
  const tax = emp.minimum_wage_earner ? 0 : Math.max(0, round2(withholding(prior.taxable + taxable, rates.tax) - prior.withholding_tax))
  const net = round2(gross - s.ee - ph.ee - pi.ee - tax - other)

  return {
    basic_pay: basic,
    overtime_pay: ot,
    allowances_taxable: allowT,
    allowances_nontaxable: allowN,
    other_deductions: other,
    gross_pay: gross,
    sss_ee: s.ee,
    sss_er: s.er,
    sss_ec: s.ec,
    philhealth_ee: ph.ee,
    philhealth_er: ph.er,
    pagibig_ee: pi.ee,
    pagibig_er: pi.er,
    taxable_income: taxable,
    withholding_tax: tax,
    net_pay: net,
  }
}

// Latest version of each rate kind in effect on a date. rows: payroll_rates rows.
export function ratesOn(rows, date) {
  const out = {}
  for (const kind of ['sss', 'philhealth', 'pagibig', 'tax']) {
    const v = rows.filter((r) => r.kind === kind && r.effective_from <= date).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
    if (v) out[kind] = { ...v.config, id: v.id, effective_from: v.effective_from }
  }
  return out
}
