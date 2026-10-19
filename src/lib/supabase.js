// A stand-in for the Supabase client, backed by the in-browser database in db.js. It covers
// only the parts of the supabase-js API this app uses, and answers in the same shapes
// ({ data, error, count }), so the pages are written exactly as for the real thing.
import { as, root } from './db.js'

export const configured = true

const q = (id) => `"${String(id).replace(/"/g, '""')}"`
const KEY = 'sample-pos-session'
const listeners = new Set()
const getSession = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY))
  } catch {
    return null
  }
}
const setSession = (s) => {
  try {
    s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY)
  } catch {
    /* private mode: the session lasts until reload */
  }
  listeners.forEach((f) => f(s ? 'SIGNED_IN' : 'SIGNED_OUT', s))
}
const uid = () => getSession()?.user.id ?? null
const wrap = (p) => p.then((data) => ({ data, error: null }), (e) => ({ data: null, error: { message: e.message } }))

// Foreign key between two tables, either direction: one = true when `from` points at `to`
// (the embed is one object), false when `to` points at `from` (an array).
async function relation(from, to) {
  const [r] = await root(
    `select c.conrelid = $1::regclass as one, a.attname as col, b.attname as ref
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute b on b.attrelid = c.confrelid and b.attnum = c.confkey[1]
      where c.contype = 'f' and ((c.conrelid = $1::regclass and c.confrelid = $2::regclass) or (c.conrelid = $2::regclass and c.confrelid = $1::regclass))`,
    [`public.${from}`, `public.${to}`],
  )
  if (!r) throw new Error(`No relationship between ${from} and ${to}`)
  return r
}

// 'id, name, sale_items(qty, unit_price)' -> SQL select list, embedding related rows as JSON.
async function columns(table, list, alias) {
  const out = []
  for (const p of list.match(/\s*[a-z_]+\s*\([^)]*\)|[^,]+/gi).map((s) => s.trim())) {
    const m = p.match(/^([a-z_]+)\s*\(([^)]*)\)$/i)
    if (!m) {
      out.push(p === '*' ? `${alias}.*` : `${alias}.${q(p)}`)
      continue
    }
    const [, emb, cols] = m
    const r = await relation(table, emb)
    const e = alias + '_e'
    const inner = `select ${await columns(emb, cols || '*', e)} from public.${q(emb)} ${e}`
    out.push(
      r.one
        ? `(select to_json(x) from (${inner} where ${e}.${q(r.ref)} = ${alias}.${q(r.col)}) x) as ${q(emb)}`
        : `(select coalesce(json_agg(x), '[]') from (${inner} where ${e}.${q(r.col)} = ${alias}.${q(r.ref)}) x) as ${q(emb)}`,
    )
  }
  return out.join(', ')
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }

class Query {
  constructor(table, runAs = (fn) => as(uid(), fn)) {
    Object.assign(this, { table, runAs, action: 'select', cols: '*', where: [], params: [], orders: [], one: null })
  }
  select(cols = '*', opts) {
    if (this.action === 'select') this.cols = cols
    else this.returning = cols
    if (opts?.count) this.count = true
    return this
  }
  // Through JSON, as supabase-js sends them: undefined keys drop out, dates become strings.
  insert(rows) {
    return Object.assign(this, { action: 'insert', rows: JSON.parse(JSON.stringify([rows].flat())) })
  }
  upsert(rows) {
    return Object.assign(this, { action: 'upsert', rows: JSON.parse(JSON.stringify([rows].flat())) })
  }
  update(values) {
    return Object.assign(this, { action: 'update', values: JSON.parse(JSON.stringify(values)) })
  }
  delete() {
    return Object.assign(this, { action: 'delete' })
  }
  is(col, v) {
    this.where.push(`t.${q(col)} is ${v === null ? 'null' : v ? 'true' : 'false'}`)
    return this
  }
  order(col, { ascending = true } = {}) {
    this.orders.push(`t.${q(col)} ${ascending ? 'asc' : 'desc'}`)
    return this
  }
  limit(n) {
    return Object.assign(this, { lim: n })
  }
  range(a, b) {
    return Object.assign(this, { off: a, lim: b - a + 1 })
  }
  single() {
    return Object.assign(this, { one: 'single' })
  }
  maybeSingle() {
    return Object.assign(this, { one: 'maybe' })
  }
  then(ok, bad) {
    return this.run().then(ok, bad)
  }

  // Filters are added in any order, so DML values go last as $n+1; filter params come first.
  async sql() {
    const T = `public.${q(this.table)}`
    const where = this.where.length ? ` where ${this.where.join(' and ')}` : ''
    const p = (v) => (this.params.push(JSON.stringify(v)), `$${this.params.length}`)
    if (this.action === 'select') {
      const tail = (this.orders.length ? ` order by ${this.orders.join(', ')}` : '') + (this.lim != null ? ` limit ${+this.lim}` : '') + (this.off ? ` offset ${+this.off}` : '')
      return `select coalesce(json_agg(x), '[]') as data from (select ${await columns(this.table, this.cols, 't')} from ${T} t${where}${tail}) x`
    }
    let dml
    if (this.action === 'delete') dml = `delete from ${T} t${where}`
    else if (this.action === 'update') {
      const cols = Object.keys(this.values).map(q)
      dml = `update ${T} t set (${cols}) = (select ${cols} from json_populate_record(null::${T}, ${p(this.values)}))${where}`
    } else {
      const cols = [...new Set(this.rows.flatMap(Object.keys))].map(q)
      dml = `insert into ${T} as t (${cols}) select ${cols} from json_populate_recordset(null::${T}, ${p(this.rows)})`
      if (this.action === 'upsert') dml += ` on conflict (id) do update set (${cols}) = (${cols.map((c) => `excluded.${c}`)})`
    }
    // json_populate_record reads columns from the table type, so `returning` can't embed; this app never does.
    return `with t as (${dml} returning ${this.returning ? this.returning.split(',').map((c) => (c.trim() === '*' ? 't.*' : `t.${q(c.trim())}`)) : '1'}) select coalesce(json_agg(t), '[]') as data from t`
  }

  async run() {
    try {
      const nWhere = this.params.length
      const text = await this.sql()
      const { data: rows, count } = await this.runAs(async (tx) => {
        const data = (await tx.query(text, this.params)).rows[0].data
        if (!this.count) return { data }
        const n = await tx.query(`select count(*)::int as n from public.${q(this.table)} t${this.where.length ? ` where ${this.where.join(' and ')}` : ''}`, this.params.slice(0, nWhere))
        return { data, count: n.rows[0].n }
      })
      let data = this.action === 'select' || this.returning ? rows : null
      if (this.one) {
        if (rows.length > 1 || (this.one === 'single' && !rows.length)) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
        data = rows[0] ?? null
      }
      return { data, error: null, count: count ?? null }
    } catch (e) {
      return { data: null, error: { message: e.message } }
    }
  }
}
for (const [name, op] of Object.entries(OPS))
  Query.prototype[name] = function (col, v) {
    this.params.push(v)
    this.where.push(`t.${q(col)} ${op} $${this.params.length}`)
    return this
  }

// Which patch in supabase/ adds each database function.
const PATCH = {
  record_sale: '008_gcash_ref_live_sales.sql',
  void_sale: '001_pos_patch.sql',
  set_stock_count: '002_inventory.sql',
  sales_report: '003_reports.sql',
  delete_product: '004_admin_sales_delete.sql',
  staff_list: '005_staff.sql',
}

// A function the database can't find means a patch is missing; say which one instead of the raw error.
export function explain(fn, error) {
  if (!error || !/could not find the function/i.test(error.message)) return error
  return { ...error, message: `The database is missing an update: supabase/${PATCH[fn] ?? 'the newest patch'}.` }
}

async function rpc(fn, args = {}) {
  const keys = Object.keys(args)
  const call = `public.${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`)})`
  const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]))
  const r = await wrap(
    as(uid(), async (tx) => {
      const [f] = (await tx.query(`select proretset as setof, prorettype::regtype::text as type from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn])).rows
      if (!f) throw new Error(`Could not find the function ${fn}`)
      if (f.setof) return (await tx.query(`select coalesce(json_agg(x), '[]') as v from ${call} x`, params)).rows[0].v
      if (f.type === 'void') return (await tx.query(`select ${call}`, params), null)
      return (await tx.query(`select to_json(${call}) as v`, params)).rows[0].v
    }),
  )
  return { ...r, error: explain(fn, r.error) }
}

async function signInWithPassword({ email, password }) {
  const [u] = await root(`update auth.users set last_sign_in_at = now() where lower(email) = lower($1) and password = $2 returning id, email`, [email, password])
  if (!u) return { data: null, error: { message: 'Invalid login credentials' } }
  const session = { access_token: u.id, user: { id: u.id, email: u.email } }
  setSession(session)
  return { data: { session }, error: null }
}

// What the real app's server function (staff.js) gets as a service-role client: no
// row-level security, plus account admin. Passwords are plain text: it's dummy data.
export const admin = {
  from: (table) => new Query(table, async (fn) => fn({ query: (text, params) => root(text, params).then((rows) => ({ rows })) })),
  auth: {
    getUser: async (token) => ({ data: { user: token ? { id: token } : null }, error: null }),
    admin: {
      createUser: async ({ email, password, user_metadata }) => {
        const r = await wrap(root(`insert into auth.users (email, password, raw_user_meta_data) values ($1, $2, $3) returning id`, [email, password, user_metadata]))
        if (r.error) return { data: null, error: { message: /unique|duplicate/i.test(r.error.message) ? 'User already registered' : r.error.message } }
        return { data: { user: r.data[0] }, error: null }
      },
      updateUserById: (id, { password }) => wrap(root(`update auth.users set password = $2 where id = $1`, [id, password])),
    },
  },
}

// Files go in storage.objects, so the bucket's row-level security still applies.
const storage = {
  from: (bucket) => ({
    upload: async (name, file, { contentType } = {}) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      return wrap(as(uid(), (tx) => tx.query(`insert into storage.objects (bucket_id, name, content_type, data) values ($1, $2, $3, $4)`, [bucket, name, contentType ?? file.type, bytes])).then(() => ({ path: name })))
    },
    createSignedUrl: (name) =>
      wrap(
        as(uid(), (tx) => tx.query(`select content_type, data from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).then(({ rows: [o] }) => {
          if (!o) throw new Error('Object not found')
          return { signedUrl: URL.createObjectURL(new Blob([o.data], { type: o.content_type })) }
        }),
      ),
  }),
}

export const supabase = {
  from: (table) => new Query(table),
  rpc,
  storage,
  auth: {
    getSession: async () => ({ data: { session: getSession() }, error: null }),
    onAuthStateChange: (f) => {
      listeners.add(f)
      return { data: { subscription: { unsubscribe: () => listeners.delete(f) } } }
    },
    signInWithPassword,
    signOut: async () => (setSession(null), { error: null }),
  },
  // Realtime: one browser, one database, nothing to listen to. Pages refetch after their own changes.
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel: () => {},
}
