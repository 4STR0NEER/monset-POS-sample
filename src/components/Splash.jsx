import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { animate, createScope, svg } from 'animejs'

const BEAT = 1000 // ms per heartbeat (60 bpm)
const SPIKE = 300 // when the ECG trace hits its spike, so the light pulse lands on it

// Lub-dub: strong pulse, brief release, smaller second pulse, long rest.
const lubDub = (peak, second, rest) => [
  { to: peak, duration: 110, ease: 'out(3)' },
  { to: rest + (peak - rest) * 0.35, duration: 160, ease: 'in(2)' },
  { to: second, duration: 110, ease: 'out(3)' },
  { to: rest, duration: BEAT - 380, ease: 'out(2)' },
]

export default function Splash({ onDone }) {
  const root = useRef(null)

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const scope = createScope({ root }).add(() => {
      if (reduce) return
      animate('.glow', { opacity: lubDub(1, 0.75, 0.2), scale: lubDub(1.12, 1.06, 0.92), delay: SPIKE, loop: true })
      animate('.logo', { scale: lubDub(1.04, 1.025, 1), delay: SPIKE, loop: true })
      animate(svg.createDrawable('.ecg'), {
        draw: [
          { from: '0 0', to: '0 1', duration: 700, ease: 'linear' },
          { to: '1 1', duration: BEAT - 700, ease: 'in(2)' },
        ],
        loop: true,
      })
      animate('.name', { opacity: [0, 1], y: [8, 0], duration: 500, delay: 250, ease: 'out(4)' })
    })
    const t = setTimeout(onDone, reduce ? 700 : 2400)
    return () => {
      clearTimeout(t)
      scope.revert()
    }
  }, [onDone])

  return (
    <motion.div
      ref={root}
      role="status"
      aria-label="Loading Sample POS"
      className="fixed inset-0 z-50 grid place-items-center bg-ink"
      exit={{ opacity: 0, filter: 'blur(6px)', transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } }}
    >
      <div className="flex flex-col items-center">
        <div className="relative grid size-56 place-items-center sm:size-64">
          <div className="glow absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,rgb(186_0_33/0.6)_0%,rgb(254_190_16/0.18)_38%,transparent_68%)] opacity-40" />
          <img src="/assets/logo.svg" alt="" className="logo relative w-2/3" />
        </div>
        <p className="name mt-2 font-display text-3xl font-extrabold uppercase tracking-[0.06em] text-paper sm:text-4xl">
          Sample <span className="text-gold">POS</span>
        </p>
        <svg viewBox="0 0 240 40" className="mt-4 h-8 w-56 overflow-visible" aria-hidden="true">
          <path className="ecg" d="M0 22 H70 l6 -4 l6 4 H92 l5 -18 l7 32 l5 -14 H130 l8 -6 l8 6 H240" fill="none" stroke="var(--color-crimson)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </motion.div>
  )
}
