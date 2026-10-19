// Prints receipts as ESC/POS commands (the receipt printer's own language) through the receipt
// helper on the front desk PC (public/helper/receipt-helper.ps1), which hands the bytes to the
// Windows print queue untouched. Chrome's printing is not used: through the XP-58 driver it gave
// blank paper or fed the whole roll, while raw ESC/POS is what the PC's old POS does too.
import { money } from './util.js'
import { RECEIPT } from '../config/receipt.js'

const ESC = '\x1b', GS = '\x1d'
const BOLD = ESC + 'E\x01', NORMAL_WEIGHT = ESC + 'E\x00'
const CENTER = ESC + 'a\x01', LEFT = ESC + 'a\x00'
const BIG = GS + '!\x11', TALL = GS + '!\x01', NORMAL_SIZE = GS + '!\x00'

// The printer's built-in font is plain ASCII: drop accents and symbols like the peso sign.
const ascii = (s) => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
const peso = (n) => 'P' + money(n).replace('₱', '')

function wrap(s, w) {
  const out = []
  while (s.length > w) {
    let cut = s.lastIndexOf(' ', w)
    if (cut <= 0) cut = w
    out.push(s.slice(0, cut))
    s = s.slice(cut).trimStart()
  }
  return [...out, s]
}

// receipt: { storeName, headerLines[], footerLines[], paperWidth (58|80), receiptNo, date, cashier, customer,
//   items[{ name, qty, lineTotal }], subtotal, discount, total,
//   paymentMethod (label), paymentRef, cash, change, banner (e.g. 'REPRINT', 'VOIDED') }
// Returns the ESC/POS commands as a string of byte values (all below 128).
export function receiptBytes(r) {
  const W = r.paperWidth === 80 ? 48 : 32 // characters per line in the standard font
  // Label on the left (wrapping if long), value right-aligned on the first line.
  const row = (l, v) => {
    v = ascii(v)
    const [first, ...rest] = wrap(ascii(l), W - v.length - 1)
    return [first.padEnd(W - v.length) + v, ...rest].join('\n') + '\n'
  }
  const centred = (s) => wrap(ascii(s), W).join('\n') + '\n'
  const hr = '-'.repeat(W) + '\n'
  return [
    ESC + '@', // reset
    CENTER,
    r.banner ? BOLD + centred(`*** ${r.banner} ***`) + NORMAL_WEIGHT : '',
    BIG + wrap(ascii(r.storeName), W / 2).join('\n') + '\n' + NORMAL_SIZE,
    ...(r.headerLines ?? []).filter(Boolean).slice(0, 3).map(centred),
    LEFT,
    hr,
    r.receiptNo ? row('Receipt #', r.receiptNo) : '',
    row('Date', r.date),
    r.cashier ? row('Staff', r.cashier) : '',
    r.customer ? row('Customer', r.customer) : '',
    hr,
    ...r.items.map((i) => row(`${i.qty} x ${i.name}`, peso(i.lineTotal))),
    hr,
    row('Subtotal', peso(r.subtotal)),
    row('Discount', Number(r.discount) > 0 ? '-' + peso(r.discount) : peso(0)),
    BOLD + TALL + row('TOTAL', peso(r.total)) + NORMAL_SIZE + NORMAL_WEIGHT,
    hr,
    row('Payment', (r.paymentMethod ?? 'Cash') + (r.paymentRef ? ` ref ${r.paymentRef}` : '')),
    row('Tendered', peso(r.cash ?? r.total)),
    row('Change', peso(r.change ?? 0)),
    hr,
    CENTER,
    ...(r.footerLines ?? []).filter(Boolean).map(centred),
    ESC + 'd\x04', // feed 4 lines so the receipt clears the tear bar
  ].join('')
}

// A saved sale row (with sale_items) -> receiptBytes input. Voided sales always print VOIDED.
export const saleReceipt = (sale, { cashier, method, banner } = {}) => ({
  ...RECEIPT,
  banner: sale.status === 'voided' ? 'VOIDED' : banner,
  receiptNo: sale.sale_no ? String(sale.sale_no).padStart(5, '0') : null,
  date: new Date(sale.sold_at ?? Date.now()).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }),
  cashier,
  customer: sale.customer_name,
  items: sale.sale_items.map((i) => ({ name: i.product_name, qty: i.qty, lineTotal: i.line_total })),
  subtotal: sale.subtotal,
  discount: sale.discount,
  total: sale.total,
  paymentMethod: method,
  paymentRef: sale.payment_ref,
  cash: sale.amount_tendered ?? sale.total,
  change: sale.change_due ?? 0,
})

// Sample receipt so staff can check the printer without making a sale.
export const testReceipt = () =>
  saleReceipt(
    {
      sale_no: 0,
      subtotal: 1350,
      discount: 50,
      total: 1300,
      amount_tendered: 1500,
      change_due: 200,
      customer_name: 'Sample <Customer> & Co.',
      sale_items: [
        { product_name: 'Day pass', qty: 1, line_total: 150 },
        { product_name: 'Monthly membership', qty: 1, line_total: 1000 },
        { product_name: 'Bottled water 500ml', qty: 4, line_total: 200 },
      ],
    },
    { cashier: 'Test', method: 'Cash', banner: 'TEST PRINT' },
  )

export async function printReceipt(r) {
  try {
    const res = await fetch(RECEIPT.helperUrl + '/print', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: btoa(receiptBytes(r)) })
    if (!res.ok) throw new Error(await res.text())
  } catch (e) {
    // fetch throws a TypeError when nothing is listening, i.e. the helper isn't running.
    alert(e instanceof TypeError ? "Receipt didn't print: the receipt helper isn't running on this PC. Start it with start-receipt-helper.bat." : `Receipt didn't print: ${e.message}`)
  }
}
