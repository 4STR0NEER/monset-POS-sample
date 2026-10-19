// npm run test:receipt — checks the ESC/POS receipt fits the 58mm paper and carries the right labels.
import assert from 'node:assert/strict'
import { receiptBytes, testReceipt } from './printReceipt.js'

let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)
const text = (b) => b.replace(/\x1b@|\x1b[Ead][\s\S]|\x1d![\s\S]/g, '') // drop the printer commands

const r = testReceipt()
const b = receiptBytes(r)
assert.ok([...b].every((c) => c.charCodeAt(0) < 128)); ok('plain ASCII bytes only (the peso sign becomes P)')
assert.ok(b.startsWith('\x1b@') && b.endsWith('\x1bd\x04')); ok('resets first, feeds past the tear bar last')
const lines = text(b).split('\n')
assert.ok(lines.every((l) => l.length <= 32), lines.find((l) => l.length > 32)); ok('every line fits 32 characters')
assert.ok(lines.includes('*** TEST PRINT ***') && lines.includes('Thank you!')); ok('banner and footer')
assert.equal(lines.find((l) => l.startsWith('TOTAL')), 'TOTAL'.padEnd(32 - 'P1,300'.length) + 'P1,300'); ok('total right-aligned')
const long = text(receiptBytes({ ...r, banner: 'VOIDED', items: [{ name: 'Protein shake chocolate extra large tub', qty: 10, lineTotal: 12345.5 }] })).split('\n')
assert.ok(long.includes('*** VOIDED ***') && long.every((l) => l.length <= 32)); ok('long item names wrap, VOIDED shows')
assert.ok(long.some((l) => l.startsWith('10 x Protein') && l.endsWith('P12,345.50'))); ok('price stays on the first line of a wrapped item')
console.log('all passed')
