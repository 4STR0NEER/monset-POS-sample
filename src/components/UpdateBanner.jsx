import { useRegisterSW } from 'virtual:pwa-register/react'

// Shown when a new deploy's service worker is waiting. Reloads only when tapped,
// so a sale in progress is never interrupted.
export default function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-lg bg-ink px-4 py-3 text-paper shadow-lg ring-1 ring-paper/10">
      <span className="text-sm font-semibold">New version available</span>
      <button onClick={() => updateServiceWorker(true)} className="press ml-auto rounded-lg bg-gold px-3 py-1.5 text-sm font-bold text-ink">
        Refresh
      </button>
    </div>
  )
}
