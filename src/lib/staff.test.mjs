// npm run test:api — checks the staff function's rules against a fake Supabase client.
import assert from 'node:assert/strict'
import { handleStaff } from './staff.js'

const ADMIN = '00000000-0000-0000-0000-00000000000a', STAFF = '00000000-0000-0000-0000-00000000000b'
function fake({ existing = [] } = {}) {
  const calls = []
  const roles = { [ADMIN]: 'admin', [STAFF]: 'staff' }
  const admin = {
    calls,
    auth: {
      getUser: async (t) => (t === 'admin-token' ? { data: { user: { id: ADMIN } } } : t === 'staff-token' ? { data: { user: { id: STAFF } } } : { data: {}, error: { message: 'bad jwt' } }),
      admin: {
        createUser: async (a) => (calls.push(['create', a]), existing.includes(a.email) ? { error: { message: 'A user with this email address has already been registered' } } : { data: { user: { id: 'new-id' } } }),
        updateUserById: async (id, a) => (calls.push(['password', id, a]), {}),
      },
    },
    from: () => {
      let row
      const q = {
        select: () => q,
        eq: (_, v) => ((row = v), q),
        maybeSingle: async () => ({ data: roles[row] ? { role: roles[row] } : null }),
        update: (u) => ({ eq: async (_, id) => (calls.push(['profile', id, u]), {}) }),
      }
      return q
    },
  }
  return admin
}
let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)
const good = { action: 'create', email: ' New@demo.test ', full_name: 'New Person', role: 'staff', password: 'longenough' }

assert.equal((await handleStaff(fake(), '', good)).status, 401); ok('no token is refused')
assert.equal((await handleStaff(fake(), 'forged', good)).status, 401); ok('invalid token is refused')
let a = fake()
assert.equal((await handleStaff(a, 'staff-token', good)).status, 403); assert.equal(a.calls.length, 0); ok('staff cannot create accounts, nothing is called')
a = fake()
const r = await handleStaff(a, 'admin-token', good)
assert.equal(r.status, 200)
assert.deepEqual(a.calls[0], ['create', { email: 'new@demo.test', password: 'longenough', email_confirm: true, user_metadata: { full_name: 'New Person' } }])
assert.deepEqual(a.calls[1], ['profile', 'new-id', { full_name: 'New Person', role: 'staff' }]); ok('admin creates a confirmed login and sets the role')
assert.equal((await handleStaff(fake(), 'admin-token', { ...good, role: 'superuser' })).status, 400); ok('only staff or admin roles')
assert.equal((await handleStaff(fake(), 'admin-token', { ...good, password: 'short' })).status, 400); ok('short passwords refused')
assert.equal((await handleStaff(fake(), 'admin-token', { ...good, email: 'nope' })).status, 400); ok('bad email refused')
assert.equal((await handleStaff(fake({ existing: ['new@demo.test'] }), 'admin-token', good)).status, 409); ok('existing email reported clearly')
a = fake()
assert.equal((await handleStaff(a, 'admin-token', { action: 'password', user_id: STAFF, password: 'newpassword1' })).status, 200)
assert.deepEqual(a.calls[0], ['password', STAFF, { password: 'newpassword1' }]); ok('admin sets a new password')
assert.equal((await handleStaff(fake(), 'staff-token', { action: 'password', user_id: ADMIN, password: 'takeover123' })).status, 403); ok('staff cannot reset anyone’s password')
console.log('all passed')
