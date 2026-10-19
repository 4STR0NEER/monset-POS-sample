import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Copy, Crown, KeyRound, Loader2, Plus, ShieldOff, UserRound, Wand2 } from 'lucide-react'
import { admin, supabase } from '../lib/supabase.js'
import { handleStaff } from '../lib/staff.js'
import { useAuth } from '../auth.jsx'
import { EASE_OUT, Segmented, Sheet, fmtDateTime } from '../components/ui.jsx'

const field = 'h-11 w-full rounded-lg bg-paper px-3 ring-1 ring-ink/15 outline-none transition-shadow duration-150 placeholder:text-smoke/70 focus:ring-2 focus:ring-gold'
const ROLE = {
  admin: ['Admin', Crown, 'bg-gold/25 text-[#6B4E00]', 'Everything: register, inventory, sales, analytics and staff.'],
  staff: ['Staff', UserRound, 'bg-ink/8 text-ink', 'Register and inventory only. No sales history or analytics.'],
  inactive: ['Inactive', ShieldOff, 'bg-mist text-smoke ring-1 ring-ink/10', 'Can’t sign in to anything. Past sales stay in the records.'],
}

// Readable temporary password, no look-alike characters (0/O, 1/l/I).
function makePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const r = crypto.getRandomValues(new Uint8Array(10))
  return [...r].map((x) => abc[x % abc.length]).join('')
}

// The account rules of a server function in the real app (lib/staff.js), run in the browser here.
async function staffApi(body) {
  const { data } = await supabase.auth.getSession()
  const r = await handleStaff(admin, data.session?.access_token, body)
  return r.status === 200 ? { data: r.json } : { error: r.json.error }
}

function RoleBadge({ role }) {
  const [label, Icon, tone] = ROLE[role] ?? ROLE.inactive
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      <Icon className="size-3.5" aria-hidden="true" /> {label}
    </span>
  )
}

export default function Staff() {
  const { session } = useAuth()
  const me = session.user.id
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null) // 'new' or a person id

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('staff_list')
    if (error) setError(error.message)
    else {
      setError(null)
      setPeople(data)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const person = people?.find((p) => p.id === open)
  const counts = (people ?? []).reduce((c, p) => ((c[p.role] = (c[p.role] ?? 0) + 1), c), {})

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl font-black uppercase leading-none">Staff</h1>
          <p className="mt-1 text-smoke">Who can sign in to the POS and what they can see.</p>
        </div>
        <button type="button" onClick={() => setOpen('new')} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> Add staff
        </button>
      </header>

      <dl className="mt-6 grid grid-cols-3 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {['admin', 'staff', 'inactive'].map((r) => (
          <div key={r} className="border-ink/8 p-5 not-last:border-r">
            <dt className="flex items-center gap-2 text-sm font-semibold text-smoke">{{ admin: 'Admins', staff: 'Staff', inactive: 'Inactive' }[r]}</dt>
            <dd className="tabular mt-2 font-display text-4xl font-black leading-none">{people ? (counts[r] ?? 0) : '–'}</dd>
            <dd className="mt-1.5 text-xs text-smoke max-sm:hidden">{ROLE[r][3]}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Couldn't load staff. {error}</span>
          <button type="button" onClick={load} className="press rounded-md bg-crimson px-3 py-1.5 font-semibold text-paper">
            Try again
          </button>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
        {!people && !error && (
          <div role="status" aria-label="Loading staff" className="divide-y divide-ink/5">
            {Array.from({ length: 4 }, (_, k) => (
              <div key={k} className="skeleton h-16" style={{ animationDelay: `${k * 60}ms` }} />
            ))}
          </div>
        )}
        {people && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Name</th>
                <th scope="col" className="px-3 py-3 font-bold">Access</th>
                <th scope="col" className="px-3 py-3 font-bold">Last signed in</th>
                <th scope="col" className="px-5 py-3 font-bold">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {people.map((p) => (
                <tr key={p.id} onClick={() => setOpen(p.id)} className={`group cursor-pointer transition-colors duration-150 hover:bg-mist/60 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3 ${p.role === 'inactive' ? 'text-smoke' : ''}`}>
                  <td className="px-5 py-3 max-md:p-0">
                    <button type="button" onClick={(e) => (e.stopPropagation(), setOpen(p.id))} className="text-left">
                      <span className="font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{p.full_name || p.email}</span>
                      {p.id === me && <span className="ml-2 text-xs font-bold uppercase tracking-[0.08em] text-smoke">You</span>}
                      <span className="block text-xs text-smoke">{p.email}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3 max-md:p-0 max-md:text-right">
                    <RoleBadge role={p.role} />
                  </td>
                  <td className="tabular px-3 py-3 text-smoke max-md:col-span-2 max-md:p-0 max-md:pt-1 max-md:text-xs">{p.last_sign_in_at ? fmtDateTime(p.last_sign_in_at) : 'Never'}</td>
                  <td className="tabular px-5 py-3 text-smoke max-md:hidden">{fmtDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {open === 'new' && <AddSheet key="add" onClose={() => setOpen(null)} onDone={load} />}
        {person && <EditSheet key="edit" person={person} isMe={person.id === me} onClose={() => setOpen(null)} onDone={load} />}
      </AnimatePresence>
    </main>
  )
}

function Problem({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-crimson/10 px-3 py-2.5 text-sm font-semibold text-crimson">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {children}
    </p>
  )
}

function Submit({ busy, children, disabled }) {
  return (
    <button type="submit" disabled={busy || disabled} className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink font-display text-xl font-black uppercase tracking-[0.03em] text-paper disabled:opacity-40">
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

function PasswordField({ value, onChange, label = 'Temporary password' }) {
  return (
    <div>
      <label htmlFor="pw" className="block text-sm font-semibold">
        {label}
      </label>
      <span className="mt-1.5 flex gap-2">
        <input id="pw" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" spellCheck={false} aria-describedby="pw-hint" className={`${field} tabular font-mono tracking-wide`} />
        <button type="button" onClick={() => onChange(makePassword())} aria-label="Make a new random password" className="press flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/15 hover:text-ink">
          <Wand2 className="size-4" aria-hidden="true" /> New
        </button>
      </span>
      <p id="pw-hint" className="mt-1 text-sm text-smoke">At least 8 characters. They can keep using it; there's no email step.</p>
    </div>
  )
}

// Shown once after creating an account or setting a password, to hand over.
function Handover({ title, email, password, onDone }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Sample POS\nEmail: ${email}\nPassword: ${password}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <motion.div initial={{ opacity: 0, transform: 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.25, ease: EASE_OUT }} className="space-y-4">
      <p role="status" className="flex items-start gap-2 rounded-lg bg-active/12 px-3 py-2.5 text-sm font-semibold text-[#0B6B35]">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {title}
      </p>
      <div className="rounded-xl bg-ink p-5 text-paper">
        <p className="text-sm text-ash">Give them these to sign in. The password isn't shown again.</p>
        <dl className="tabular mt-3 space-y-2">
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.1em] text-ash">Email</dt>
            <dd className="text-lg font-semibold break-all">{email}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.1em] text-ash">Password</dt>
            <dd className="font-mono text-2xl font-semibold tracking-wide text-gold">{password}</dd>
          </div>
        </dl>
        <button type="button" onClick={copy} className="press mt-4 flex h-10 items-center gap-2 rounded-lg bg-paper/10 px-3 text-sm font-semibold">
          {copied ? <CircleCheck className="size-4 text-active" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy both'}
        </button>
      </div>
      <button type="button" onClick={onDone} autoFocus className="press h-12 w-full rounded-xl bg-gold font-display text-xl font-black uppercase tracking-[0.03em] text-ink">
        Done
      </button>
    </motion.div>
  )
}

function AddSheet({ onClose, onDone }) {
  const [f, setF] = useState(() => ({ full_name: '', email: '', password: makePassword(), role: 'staff' }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [made, setMade] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!f.full_name.trim() || !f.email.trim()) return setErr('Enter their name and email.')
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    const { error } = await staffApi({ action: 'create', ...f })
    setBusy(false)
    if (error) return setErr(error)
    setMade({ email: f.email.trim().toLowerCase(), password: f.password })
    onDone()
  }

  return (
    <Sheet title="Add staff" subtitle="Creates their POS login. No email is sent." onClose={onClose}>
      {made ? (
        <Handover title={`${f.full_name.trim()} can sign in now.`} email={made.email} password={made.password} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-semibold">
            Name
            <input autoFocus value={f.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="Shown on sales and stock history" className={`${field} mt-1.5`} />
          </label>
          <div>
            <label className="block text-sm font-semibold">
              Email
              <input type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} placeholder="name@example.com" aria-describedby="email-hint" className={`${field} mt-1.5`} />
            </label>
            <p id="email-hint" className="mt-1 text-sm text-smoke">Their sign-in name. It doesn't have to be a real inbox.</p>
          </div>
          <PasswordField value={f.password} onChange={set('password')} />
          <div>
            <p className="text-sm font-semibold">Access</p>
            <Segmented id="add-role" className="mt-1.5" value={f.role} onChange={set('role')} options={[['staff', 'Staff', UserRound], ['admin', 'Admin', Crown]]} />
            <p className="mt-1.5 text-sm text-smoke">{ROLE[f.role][3]}</p>
          </div>
          {err && <Problem>{err}</Problem>}
          <Submit busy={busy}>Create account</Submit>
        </form>
      )}
    </Sheet>
  )
}

function EditSheet({ person, isMe, onClose, onDone }) {
  const [name, setName] = useState(person.full_name ?? '')
  const [role, setRole] = useState(person.role)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(null)
  const [pw, setPw] = useState(makePassword())
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState(null)
  const [pwDone, setPwDone] = useState(null)
  const changed = name.trim() !== (person.full_name ?? '') || role !== person.role

  const save = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setErr('Enter their name.')
    setBusy(true)
    setErr(null)
    setSaved(null)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), role }).eq('id', person.id)
    setBusy(false)
    if (error) return setErr(error.message)
    setSaved(role !== person.role ? `${name.trim()} is now ${ROLE[role][0].toLowerCase()}.` : 'Saved.')
    onDone()
  }

  const resetPw = async (e) => {
    e.preventDefault()
    if (pw.length < 8) return setPwErr('Password must be at least 8 characters.')
    setPwBusy(true)
    setPwErr(null)
    const { error } = await staffApi({ action: 'password', user_id: person.id, password: pw })
    setPwBusy(false)
    if (error) return setPwErr(error)
    setPwDone(pw)
  }

  if (pwDone) return <Sheet title={person.full_name || person.email} subtitle={person.email} onClose={onClose}><Handover title="New password set. Their old one no longer works." email={person.email} password={pwDone} onDone={onClose} /></Sheet>

  return (
    <Sheet title={person.full_name || person.email} subtitle={`${person.email} · ${person.last_sign_in_at ? `last signed in ${fmtDateTime(person.last_sign_in_at)}` : 'never signed in'}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <AnimatePresence>
          {saved && (
            <motion.p role="status" className="flex items-start gap-2 rounded-lg bg-active/12 px-3 py-2.5 text-sm font-semibold text-[#0B6B35]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {saved}
            </motion.p>
          )}
        </AnimatePresence>
        <label className="block text-sm font-semibold">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1.5`} />
        </label>
        <div>
          <p className="text-sm font-semibold">Access</p>
          {isMe ? (
            <p className="mt-1.5 rounded-lg bg-paper p-3 text-sm text-smoke ring-1 ring-ink/5">
              <RoleBadge role={person.role} /> <span className="ml-1">You can't change your own access, so nobody locks themselves out. Another admin can.</span>
            </p>
          ) : (
            <>
              <Segmented id="edit-role" className="mt-1.5" value={role} onChange={setRole} options={[['staff', 'Staff', UserRound], ['admin', 'Admin', Crown], ['inactive', 'Inactive', ShieldOff]]} />
              <p className="mt-1.5 text-sm text-smoke">{ROLE[role][3]}</p>
            </>
          )}
        </div>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy} disabled={!changed}>
          Save changes
        </Submit>
      </form>

      <form onSubmit={resetPw} className="mt-6 space-y-4 border-t border-ink/10 pt-6">
        <h3 className="flex items-center gap-2 font-display text-2xl font-extrabold uppercase leading-none">
          <KeyRound className="size-5" aria-hidden="true" /> Set a new password
        </h3>
        <p className="text-sm text-smoke">For a forgotten password. Their current one stops working straight away.</p>
        <PasswordField value={pw} onChange={setPw} label="New password" />
        {pwErr && <Problem>{pwErr}</Problem>}
        <Submit busy={pwBusy}>Set password</Submit>
      </form>
    </Sheet>
  )
}
