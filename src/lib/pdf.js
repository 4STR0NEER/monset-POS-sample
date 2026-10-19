// PDF documents for auditors and the owner. Built with jsPDF in the browser; loaded only
// when someone clicks Download (see loadPdf in src/lib/reports.js).
// Standard PDF fonts can't draw the peso sign, so amounts are "PHP 1,234.00" and
// negatives use accounting brackets: (1,234.00).
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const INK = [25, 23, 27]
const GOLD = [254, 190, 16]
const CRIMSON = [186, 0, 33]
const SMOKE = [94, 90, 99]
const MIST = [242, 242, 242]
const LINE = [228, 226, 230]
const M = 14 // page margin, mm
const W = 210 // A4 width, mm

const num = (v) => Number(v) || 0
export const amt = (v) => {
  const n = Math.round(num(v) * 100) / 100
  const s = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}
const php = (v) => `PHP ${amt(v)}`
const pct = (a, b) => (b ? `${Math.round((num(a) / num(b)) * 100)}%` : '-')
const day = (d, o = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })
const stamp = (t = new Date()) => t.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
// Standard fonts only cover Latin-1: swap typographic punctuation for plain characters.
const plain = (s) => String(s ?? '').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '')

function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')
  doc.setLineHeightFactor(1.25)
  return doc
}

// Dark brand band with logo, gym name, document title and period.
function header(doc, { logo, title, period }) {
  doc.setFillColor(...INK)
  doc.rect(0, 0, W, 30, 'F')
  if (logo) doc.addImage(logo, 'JPEG', M, 5, 20, 20)
  const x = logo ? M + 25 : M
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(15)
  doc.text('DEMO FITNESS', x, 13)
  doc.setTextColor(...GOLD).setFontSize(10.5)
  doc.text(plain(title).toUpperCase(), x, 19.5)
  doc.setTextColor(200, 196, 204).setFont('helvetica', 'normal').setFontSize(8.5)
  doc.text('3rd Floor CRD Bldg., Miñoza St., Talamban, Cebu City', x, 24.5)
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(10)
  doc.text(plain(period), W - M, 13, { align: 'right' })
  return 40
}

function footer(doc, by) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, 285, W - M, 285)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SMOKE)
    doc.text(plain(`Sample POS  |  Generated ${stamp()}${by ? ` by ${by}` : ''}  |  Amounts in Philippine pesos (PHP)`), M, 290)
    doc.text(`Page ${i} of ${n}`, W - M, 290, { align: 'right' })
  }
}

// Section title; starts a new page when there isn't room for the title plus a few rows.
function section(doc, y, title, note) {
  if (y > 250) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...INK)
  doc.text(plain(title).toUpperCase(), M, y)
  doc.setDrawColor(...GOLD).setLineWidth(0.8).line(M, y + 1.8, M + 12, y + 1.8)
  if (note) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    doc.text(plain(note), W - M, y, { align: 'right' })
  }
  return y + 5
}

function table(doc, y, { head, body, foot, right = [], bold = [], widths = {}, emphasize }) {
  const columnStyles = {}
  right.forEach((i) => (columnStyles[i] = { ...(columnStyles[i] ?? {}), halign: 'right' }))
  Object.entries(widths).forEach(([i, w]) => (columnStyles[i] = { ...(columnStyles[i] ?? {}), cellWidth: w }))
  autoTable(doc, {
    startY: y,
    head: head && [head.map(plain)],
    body: body.map((r) => r.map((c) => (typeof c === 'object' && c !== null ? { ...c, content: plain(c.content) } : plain(c)))),
    foot: foot && [foot.map(plain)],
    theme: 'plain',
    margin: { left: M, right: M, top: 18, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8.8, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: MIST, textColor: SMOKE, fontStyle: 'bold', fontSize: 7.8 },
    footStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK, lineWidth: { top: 0.4, bottom: 0 }, lineColor: INK },
    columnStyles,
    didParseCell: (d) => {
      if (d.section === 'head' && right.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'foot' && right.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'body' && bold.includes(d.row.index)) d.cell.styles.fontStyle = 'bold'
      if (d.section === 'body' && emphasize?.(d.row.index)) {
        d.cell.styles.fillColor = [255, 247, 221]
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
  return doc.lastAutoTable.finalY + 8
}

function signatures(doc, y, labels) {
  if (y > 255) {
    doc.addPage()
    y = 30
  }
  y += 10
  const w = (W - 2 * M - 10 * (labels.length - 1)) / labels.length
  labels.forEach((l, i) => {
    const x = M + i * (w + 10)
    doc.setDrawColor(...INK).setLineWidth(0.3).line(x, y, x + w, y)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    doc.text(plain(l), x, y + 4)
  })
  return y + 12
}

const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' }

// ---------------------------------------------------------------------------------
// Sales & profit report for a period. r = sales_report() result.
// expenses: recorded expenses in the period with a category name.
// payroll: finalized pay runs paid in the period with their items.
// ---------------------------------------------------------------------------------
export function salesReportPdf({ r, label, expenses = [], payroll = [], logo, by }) {
  const doc = newDoc()
  const t = r.totals
  const p = r.previous
  const ex = r.expenses ?? { total: 0, previous: 0, by_category: [] }
  const cost = num(t.revenue) - num(t.gross_profit)
  const prevCost = num(p.revenue) - num(p.gross_profit)
  const net = num(t.gross_profit) - num(ex.total)
  const prevNet = num(p.gross_profit) - num(ex.previous)
  let y = header(doc, { logo, title: 'Sales & profit report', period: label })

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
  doc.text(plain(`Period ${day(r.from)} to ${day(r.to)}. Compared with the ${num(r.daily?.length) || ''} days before it. Voided sales and expenses are excluded.`), M, y)
  y += 7

  // Headline figures.
  const tiles = [
    ['Sales', t.revenue],
    ['Gross profit', t.gross_profit],
    ['Expenses', ex.total],
    [net < 0 ? 'Net loss' : 'Net profit', net],
  ]
  const tw = (W - 2 * M - 9) / 4
  tiles.forEach(([k, v], i) => {
    const x = M + i * (tw + 3)
    doc.setFillColor(...(i === 3 ? INK : MIST))
    doc.roundedRect(x, y, tw, 19, 2, 2, 'F')
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...(i === 3 ? [200, 196, 204] : SMOKE))
    doc.text(k.toUpperCase(), x + 3.5, y + 6)
    doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(...(i === 3 ? (net < 0 ? [255, 138, 155] : GOLD) : INK))
    doc.text(amt(v), x + 3.5, y + 14)
  })
  y += 28

  y = section(doc, y, 'Profit and loss', 'PHP')
  const catRows = ex.by_category.map((c) => [`    ${c.category}`, amt(c.total), ''])
  y = table(doc, y, {
    head: ['', 'This period', 'Previous period', 'Change'],
    body: [
      ['Sales', amt(t.revenue), amt(p.revenue), amt(num(t.revenue) - num(p.revenue))],
      ['Less: cost of goods sold', amt(cost), amt(prevCost), amt(cost - prevCost)],
      ['Gross profit', amt(t.gross_profit), amt(p.gross_profit), amt(num(t.gross_profit) - num(p.gross_profit))],
      ['Less: operating expenses', '', '', ''],
      ...catRows.map((r) => [...r, '']),
      ['Total operating expenses', amt(ex.total), amt(ex.previous), amt(num(ex.total) - num(ex.previous))],
      [net < 0 ? 'Net loss' : 'Net profit', amt(net), amt(prevNet), amt(net - prevNet)],
    ],
    right: [1, 2, 3],
    bold: [2, 4 + catRows.length],
    emphasize: (i) => i === 5 + catRows.length,
    widths: { 0: 78 },
  })

  y = section(doc, y, 'Key figures')
  y = table(doc, y, {
    head: ['', 'This period', 'Previous period'],
    body: [
      ['Receipts', String(t.receipts), String(p.receipts)],
      ['Average sale', amt(t.receipts ? num(t.revenue) / t.receipts : 0), amt(p.receipts ? num(p.revenue) / p.receipts : 0)],
      ['Items sold', String(t.items), String(p.items)],
      ['Gross margin', pct(t.gross_profit, t.revenue), pct(p.gross_profit, p.revenue)],
      ['Discounts given', amt(t.discounts), '-'],
      ['Voided receipts', `${r.voids.count} (${amt(r.voids.total)})`, '-'],
    ],
    right: [1, 2],
    widths: { 0: 78 },
  })

  const payTotal = r.payments.reduce((s, x) => s + num(x.total), 0)
  y = section(doc, y, 'Sales by payment method', 'PHP')
  y = table(doc, y, {
    head: ['Method', 'Receipts', 'Amount', 'Share'],
    body: r.payments.length ? r.payments.map((x) => [METHOD[x.method] ?? x.method, String(x.receipts), amt(x.total), pct(x.total, payTotal)]) : [['No sales', '', '', '']],
    foot: r.payments.length ? ['Total', String(r.payments.reduce((s, x) => s + num(x.receipts), 0)), amt(payTotal), '100%'] : undefined,
    right: [1, 2, 3],
  })

  y = section(doc, y, 'Sales by category', 'PHP, before receipt discounts')
  y = table(doc, y, {
    head: ['Category', 'Units', 'Sales', 'Gross profit', 'Margin'],
    body: r.categories.length ? r.categories.map((c) => [c.category, String(c.units), amt(c.revenue), amt(c.profit), pct(c.profit, c.revenue)]) : [['No sales', '', '', '', '']],
    right: [1, 2, 3, 4],
  })

  const top = r.products.slice(0, 20)
  y = section(doc, y, `Top ${top.length} products`, 'PHP, ranked by sales')
  y = table(doc, y, {
    head: ['#', 'Product', 'Category', 'Units', 'Sales', 'Gross profit'],
    body: top.length ? top.map((x, i) => [String(i + 1), x.name, x.category, String(x.units), amt(x.revenue), amt(x.profit)]) : [['', 'No sales', '', '', '', '']],
    right: [3, 4, 5],
    widths: { 0: 8 },
  })

  const plans = r.products.filter((x) => x.category === 'Membership')
  if (plans.length) {
    y = section(doc, y, 'Memberships sold', 'PHP')
    y = table(doc, y, {
      head: ['Plan', 'Sold', 'Sales'],
      body: plans.map((x) => [x.name, String(x.units), amt(x.revenue)]),
      foot: ['Total', String(plans.reduce((s, x) => s + num(x.units), 0)), amt(plans.reduce((s, x) => s + num(x.revenue), 0))],
      right: [1, 2],
    })
  }

  y = section(doc, y, 'Sales by staff', 'PHP')
  y = table(doc, y, {
    head: ['Staff', 'Receipts', 'Sales', 'Average sale', 'Memberships', 'Discounts'],
    body: r.staff.length ? r.staff.map((s) => [s.name, String(s.receipts), amt(s.revenue), amt(s.receipts ? num(s.revenue) / s.receipts : 0), String(s.memberships), amt(s.discounts)]) : [['No sales', '', '', '', '', '']],
    right: [1, 2, 3, 4, 5],
  })

  if (payroll.length) {
    const sum = (items, f) => items.reduce((s, it) => s + f(it), 0)
    const er = (it) => num(it.sss_er) + num(it.sss_ec) + num(it.philhealth_er) + num(it.pagibig_er)
    y = section(doc, y, 'Payroll paid in this period', 'PHP, finalized pay runs')
    y = table(doc, y, {
      head: ['Pay period', 'Pay date', 'Staff', 'Gross pay', 'Employer contrib.', 'Net pay'],
      body: payroll.map((run) => [`${day(run.period_start, { month: 'short', day: 'numeric' })} - ${day(run.period_end)}`, day(run.pay_date), String(run.payroll_items.length), amt(sum(run.payroll_items, (it) => num(it.gross_pay))), amt(sum(run.payroll_items, er)), amt(sum(run.payroll_items, (it) => num(it.net_pay)))]),
      right: [2, 3, 4, 5],
    })
  }

  y = section(doc, y, 'Expenses', `${expenses.length} entries, PHP`)
  y = table(doc, y, {
    head: ['Date', 'Description', 'Category', 'OR / ref.', 'Paid via', 'Amount'],
    body: expenses.length ? expenses.map((e) => [day(e.expense_date, { month: 'short', day: 'numeric' }), e.description + (e.vendor ? ` (${e.vendor})` : ''), e.category, e.reference_no ?? '', METHOD[e.payment_method] ?? e.payment_method, amt(e.amount)]) : [['', 'No expenses recorded', '', '', '', '']],
    foot: expenses.length ? ['', 'Total', '', '', '', amt(expenses.reduce((s, e) => s + num(e.amount), 0))] : undefined,
    right: [5],
    widths: { 0: 16, 1: 68 },
  })

  signatures(doc, y, ['Prepared by', 'Reviewed by', 'Approved by'])
  footer(doc, by)
  return doc
}

// ---------------------------------------------------------------------------------
// Payslips for one pay run: a summary page, then one payslip per employee.
// ---------------------------------------------------------------------------------
export function payslipsPdf({ run, items, employees = [], logo, by }) {
  const doc = newDoc()
  const period = `${day(run.period_start, { month: 'short', day: 'numeric' })} - ${day(run.period_end)}`
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]))
  const sum = (k) => items.reduce((s, it) => s + num(it[k]), 0)
  const er = sum('sss_er') + sum('sss_ec') + sum('philhealth_er') + sum('pagibig_er')
  const draft = run.status !== 'finalized'

  let y = header(doc, { logo, title: `Payroll summary${draft ? ' (not final)' : ''}`, period })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
  doc.text(plain(`Pay date ${day(run.pay_date)}. ${items.length} payslip${items.length === 1 ? '' : 's'}. Status: ${run.status}.`), M, y)
  y += 8
  y = section(doc, y, 'Payslips', 'PHP')
  y = table(doc, y, {
    head: ['Employee', 'Gross', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Tax', 'Other', 'Net pay'],
    body: items.map((it) => [it.employee_name, amt(it.gross_pay), amt(it.sss_ee), amt(it.philhealth_ee), amt(it.pagibig_ee), amt(it.withholding_tax), amt(it.other_deductions), amt(it.net_pay)]),
    foot: ['Total', amt(sum('gross_pay')), amt(sum('sss_ee')), amt(sum('philhealth_ee')), amt(sum('pagibig_ee')), amt(sum('withholding_tax')), amt(sum('other_deductions')), amt(sum('net_pay'))],
    right: [1, 2, 3, 4, 5, 6, 7],
  })
  y = section(doc, y, 'To remit', 'PHP')
  y = table(doc, y, {
    head: ['Agency', 'Employee share', 'Employer share', 'Total'],
    body: [
      ['SSS (employer share includes EC)', amt(sum('sss_ee')), amt(sum('sss_er') + sum('sss_ec')), amt(sum('sss_ee') + sum('sss_er') + sum('sss_ec'))],
      ['PhilHealth', amt(sum('philhealth_ee')), amt(sum('philhealth_er')), amt(sum('philhealth_ee') + sum('philhealth_er'))],
      ['Pag-IBIG', amt(sum('pagibig_ee')), amt(sum('pagibig_er')), amt(sum('pagibig_ee') + sum('pagibig_er'))],
      ['BIR withholding tax on compensation', amt(sum('withholding_tax')), '-', amt(sum('withholding_tax'))],
    ],
    right: [1, 2, 3],
  })
  y = table(doc, y, {
    body: [
      ['Gross pay', amt(sum('gross_pay'))],
      ['Employer contributions', amt(er)],
      ['Total cost to the gym', amt(sum('gross_pay') + er)],
    ],
    right: [1],
    bold: [2],
    widths: { 0: 120 },
  })
  if (run.rates) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    const v = ['sss', 'philhealth', 'pagibig', 'tax'].filter((k) => run.rates[k]).map((k) => `${{ sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG', tax: 'Tax' }[k]} from ${day(run.rates[k].effective_from)}`)
    doc.text(plain(`Rate versions used: ${v.join(', ')}.`), M, y - 3)
  }
  signatures(doc, y + 2, ['Prepared by', 'Approved by'])

  for (const it of items) {
    doc.addPage()
    const e = byId[it.employee_id] ?? {}
    let py = header(doc, { logo, title: `Payslip${draft ? ' (not final)' : ''}`, period })
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...INK)
    doc.text(plain(it.employee_name), M, py + 2)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
    const basis = { monthly: 'month', daily: 'day', hourly: 'hour' }[it.pay_basis]
    doc.text(plain(`${e.position ? e.position + '  |  ' : ''}Rate PHP ${amt(it.rate)} per ${basis}  |  Pay date ${day(run.pay_date)}`), M, py + 7.5)
    const ids = [['SSS', e.sss_no], ['PhilHealth', e.philhealth_no], ['Pag-IBIG', e.pagibig_no], ['TIN', e.tin]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`)
    if (ids.length) doc.text(plain(ids.join('   ')), M, py + 12.5)
    py += 20

    const half = (W - 2 * M - 6) / 2
    const earnings = [
      ['Basic pay' + (it.days_worked != null ? ` (${num(it.days_worked)} days)` : it.hours_worked != null ? ` (${num(it.hours_worked)} hrs)` : ''), amt(it.basic_pay)],
      ['Overtime', amt(it.overtime_pay)],
      ['Allowances (taxable)', amt(it.allowances_taxable)],
      ['Allowances (non-taxable)', amt(it.allowances_nontaxable)],
    ]
    const deductions = [
      ['SSS', amt(it.sss_ee)],
      ['PhilHealth', amt(it.philhealth_ee)],
      ['Pag-IBIG', amt(it.pagibig_ee)],
      ['Withholding tax', amt(it.withholding_tax)],
      ['Other' + (it.deductions_note ? ` (${it.deductions_note})` : ''), amt(it.other_deductions)],
    ]
    const totalDed = num(it.sss_ee) + num(it.philhealth_ee) + num(it.pagibig_ee) + num(it.withholding_tax) + num(it.other_deductions)
    const twoCol = (x, head, body, foot) =>
      autoTable(doc, {
        startY: py,
        margin: { left: x, right: W - x - half },
        tableWidth: half,
        head: [head.map(plain)],
        body: body.map((r) => r.map(plain)),
        foot: [foot.map(plain)],
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
        headStyles: { fillColor: MIST, textColor: SMOKE, fontStyle: 'bold', fontSize: 8 },
        footStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK, lineWidth: { top: 0.4, bottom: 0 }, lineColor: INK },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => d.column.index === 1 && (d.cell.styles.halign = 'right'),
      })
    twoCol(M, ['Earnings', 'PHP'], earnings, ['Gross pay', amt(it.gross_pay)])
    const endL = doc.lastAutoTable.finalY
    twoCol(M + half + 6, ['Deductions', 'PHP'], deductions, ['Total deductions', amt(totalDed)])
    py = Math.max(endL, doc.lastAutoTable.finalY) + 8

    doc.setFillColor(...INK)
    doc.roundedRect(M, py, W - 2 * M, 18, 2, 2, 'F')
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(200, 196, 204)
    doc.text('NET PAY', M + 5, py + 7)
    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...GOLD)
    doc.text(php(it.net_pay), W - M - 5, py + 12, { align: 'right' })
    py += 26

    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SMOKE)
    doc.text(plain(`Employer also paid: SSS PHP ${amt(num(it.sss_er) + num(it.sss_ec))} (incl. EC), PhilHealth PHP ${amt(it.philhealth_er)}, Pag-IBIG PHP ${amt(it.pagibig_er)}. Taxable income this payslip: PHP ${amt(it.taxable_income)}.`), M, py, { maxWidth: W - 2 * M })
    py += 10
    signatures(doc, py, ['Received by (signature over printed name)', 'Date'])
  }

  footer(doc, by)
  if (draft) {
    // Mark every page so a draft is never mistaken for a final payslip.
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
      doc.setPage(i)
      doc.setFillColor(...CRIMSON)
      doc.roundedRect(W - M - 38, 19.5, 38, 7, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(255, 255, 255)
      doc.text('DRAFT - NOT FINAL', W - M - 19, 24.2, { align: 'center' })
    }
  }
  return doc
}

