// The demo's "backend": the real schema and patches in supabase/ running in the browser
// (PGlite, Postgres in WebAssembly), saved in IndexedDB. No server, no network.
import { PGlite } from '@electric-sql/pglite'
import { install } from './seed.js'

const sql = import.meta.glob('../../supabase/*.sql', { query: '?raw', import: 'default', eager: true })
const files = Object.keys(sql).filter((f) => /\/(schema|\d{3}_.*)\.sql$/.test(f)).sort((a, b) => (a.endsWith('schema.sql') ? -1 : b.endsWith('schema.sql') ? 1 : a < b ? -1 : 1))

const NAME = 'sample-pos'
// Bump to wipe every visitor's saved demo data after a schema or seed change.
const VERSION = 1

async function open() {
  const db = await PGlite.create(`idb://${NAME}`, { relaxedDurability: true }) // flush to IndexedDB in the background
  const meta = await db.query(`select to_regclass('public.demo_meta') is not null as ok`)
  if (meta.rows[0].ok && (await db.query('select version from demo_meta')).rows[0]?.version === VERSION) return db
  if (meta.rows[0].ok) return (await db.close(), await wipe(), open())
  await install(db, files.map((f) => sql[f]))
  await db.query('insert into demo_meta values ($1)', [VERSION])
  return db
}

const wipe = () =>
  new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(`/pglite/${NAME}`)
    r.onsuccess = r.onerror = r.onblocked = resolve
  })

export const ready = open()

// Runs fn(tx) in one transaction as that user, so row-level security and auth.uid() behave
// as they do through Supabase. uid null = the signed-out "anon" role. Errors roll back.
export async function as(uid, fn) {
  const db = await ready
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
    return fn(tx)
  })
}

// Superuser access, for the parts Supabase runs server side (sign-in, account admin).
export const root = async (q, params) => (await (await ready).query(q, params)).rows

export async function resetDemo() {
  localStorage.removeItem('sample-pos-session')
  await (await ready).close()
  await wipe()
  location.reload()
}
