import { lazy, Suspense, useCallback, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Banknote, BarChart3, Boxes, LogOut, ReceiptText, RotateCcw, ShoppingCart, UsersRound, Wallet } from 'lucide-react'
import { resetDemo } from './lib/db.js'
import { AuthProvider, useAuth } from './auth.jsx'
import Login, { NoAccess } from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Inventory from './pages/Inventory.jsx'
// Admin-only pages load on demand, so the register tablet never downloads them.
const Sales = lazy(() => import('./pages/Sales.jsx'))
const Staff = lazy(() => import('./pages/Staff.jsx'))
const Expenses = lazy(() => import('./pages/Expenses.jsx'))
const Payroll = lazy(() => import('./pages/payroll/Payroll.jsx'))
const Analytics = lazy(() => import('./pages/Analytics.jsx'))
import Splash from './components/Splash.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'

export default function App() {
  return (
    <>
      <UpdateBanner />
      <Main />
    </>
  )
}

function Main() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  )
}

// The heartbeat splash covers boot and the session/role check, and plays at least once.
function Gate() {
  const { session, profile } = useAuth()
  const [played, setPlayed] = useState(false)
  const done = useCallback(() => setPlayed(true), [])
  const loading = session === undefined || (session && profile === undefined)
  return (
    <>
      <AnimatePresence>{(loading || !played) && <Splash key="splash" onDone={done} />}</AnimatePresence>
      {!loading && (!session ? <Login /> : profile.role === 'staff' || profile.role === 'admin' ? <Shell /> : <NoAccess />)}
    </>
  )
}

// [label, path, icon, adminOnly]
const NAV = [
  ['Register', '/', ShoppingCart, false],
  ['Sales', '/sales', ReceiptText, false],
  ['Inventory', '/inventory', Boxes, false],
  ['Expenses', '/expenses', Wallet, true],
  ['Payroll', '/payroll', Banknote, true],
  ['Analytics', '/analytics', BarChart3, true],
  ['Staff', '/staff', UsersRound, true],
]

function Shell() {
  const { profile, isAdmin, signOut } = useAuth()
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-ink px-3 text-paper sm:px-4">
        <img src="/assets/logo.svg" alt="" className="size-9 shrink-0" />
        <span className="font-display text-lg font-extrabold uppercase leading-none tracking-[0.04em] max-sm:hidden">
          Sample <span className="text-gold">POS</span>
        </span>
        <nav aria-label="Main" className="flex min-w-0 gap-1 overflow-x-auto sm:ml-4">
          {NAV.filter((n) => isAdmin || !n[3]).map(([label, to, Icon]) => (
            <NavLink key={to} to={to} end className="relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold">
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-paper/10" transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }} />}
                  {isActive && <motion.span layoutId="nav-bar" className="absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-gold" transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }} />}
                  <Icon className={`relative size-4 ${isActive ? 'text-gold' : 'text-ash'}`} aria-hidden="true" />
                  <span className={`relative max-xl:sr-only ${isActive ? 'text-paper' : 'text-ash'}`}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <p className="text-right text-sm leading-tight max-sm:hidden">
            <span className="block font-semibold">{profile.full_name}</span>
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-gold">{profile.role}</span>
          </p>
          <button type="button" onClick={() => confirm('Reset the demo? Every change is lost and the dummy data comes back.') && resetDemo()} aria-label="Reset demo data" title="Reset demo data" className="press grid size-10 place-items-center rounded-lg text-ash ring-1 ring-paper/10 hover:text-paper">
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={signOut} aria-label="Sign out" className="press grid size-10 place-items-center rounded-lg text-ash ring-1 ring-paper/10 hover:text-paper">
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>
      <Suspense fallback={null}>
        <Routes>
        <Route path="/" element={<Register />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/sales" element={<Sales />} />
        {isAdmin && <Route path="/staff" element={<Staff />} />}
        {isAdmin && <Route path="/expenses" element={<Expenses />} />}
        {isAdmin && <Route path="/payroll/*" element={<Payroll />} />}
        {isAdmin && <Route path="/analytics/*" element={<Analytics />} />}
        <Route path="*" element={<Soon title="Not found" />} />
      </Routes>
      </Suspense>
    </div>
  )
}

function Soon({ title, phase }) {
  return (
    <main className="grid min-h-[calc(100dvh-3.5rem)] place-items-center px-4 text-center">
      <div>
        {phase && <p className="text-sm font-bold uppercase tracking-[0.14em] text-smoke">Phase {phase}</p>}
        <h1 className="font-display text-5xl font-black uppercase">{title}</h1>
      </div>
    </main>
  )
}
