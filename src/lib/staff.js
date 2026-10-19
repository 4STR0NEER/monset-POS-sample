// Admin-only account actions: create a login, set a new password. With a real Supabase
// these need the service-role key and run on a server; in the demo, `admin` is the
// stand-in from supabase.js. `token` is the caller's access token.
// Returns { status, json }.

const fail = (status, error) => ({ status, json: { error } })
const ROLES = ['staff', 'admin']

export async function handleStaff(admin, token, body = {}) {
  if (!token) return fail(401, 'Sign in again.')
  const { data: auth, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !auth?.user) return fail(401, 'Sign in again.')
  const { data: me } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
  if (me?.role !== 'admin') return fail(403, 'Only an admin can manage staff.')

  const password = String(body.password ?? '')
  if (password.length < 8) return fail(400, 'Password must be at least 8 characters.')

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const full_name = String(body.full_name ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Enter a valid email.')
    if (!full_name) return fail(400, 'Enter their name.')
    if (!ROLES.includes(body.role)) return fail(400, 'Pick staff or admin.')

    // email_confirm: no confirmation email, they can sign in straight away.
    const { data: made, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })
    if (error) return /already/i.test(error.message) ? fail(409, 'That email already has an account.') : fail(400, error.message)

    // The sign-up trigger created the profile as 'inactive'; give it the chosen role.
    const { error: roleErr } = await admin.from('profiles').update({ full_name, role: body.role }).eq('id', made.user.id)
    if (roleErr) return fail(500, `Account created, but setting the role failed: ${roleErr.message}`)
    return { status: 200, json: { id: made.user.id } }
  }

  if (body.action === 'password') {
    const id = String(body.user_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Unknown account.')
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    if (error) return fail(400, error.message)
    return { status: 200, json: { ok: true } }
  }

  return fail(400, 'Unknown action.')
}
