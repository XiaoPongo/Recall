'use client'

/**
 * SwipeRow — touch-friendly swipe-to-act wrapper.
 * Swipe right = accept/dismiss, swipe left = snooze (with soft color
 * reveals behind the card). Buttons stay available for accessibility.
 */
import type { ReactNode } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'

const THRESHOLD = 88

export function SwipeRow({
  onSwipeLeft,
  onSwipeRight,
  leftHint,
  rightHint,
  children,
  className,
}: {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** revealed on the LEFT edge when swiping right */
  leftHint?: ReactNode
  /** revealed on the RIGHT edge when swiping left */
  rightHint?: ReactNode
  children: ReactNode
  className?: string
}) {
  const x = useMotionValue(0)
  const leftOpacity = useTransform(x, [16, THRESHOLD], [0, 1])
  const rightOpacity = useTransform(x, [-THRESHOLD, -16], [1, 0])
  const draggable = !!(onSwipeLeft || onSwipeRight)

  function release() {
    const dx = x.get()
    if (dx > THRESHOLD && onSwipeRight) {
      animate(x, 420, { duration: 0.22, ease: 'easeOut', onComplete: () => onSwipeRight() })
    } else if (dx < -THRESHOLD && onSwipeLeft) {
      animate(x, -420, { duration: 0.22, ease: 'easeOut', onComplete: () => onSwipeLeft() })
    } else {
      animate(x, 0, { type: 'spring', stiffness: 420, damping: 34 })
    }
  }

  return (
    <div className={className ? `relative ${className}` : 'relative'}>
      {/* soft reveals */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-3xl bg-emerald-500/15 pl-6 dark:bg-emerald-400/15"
        style={{ opacity: leftOpacity }}
      >
        {leftHint}
      </motion.div>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-3xl bg-amber-400/20 pr-6 dark:bg-amber-300/15"
        style={{ opacity: rightOpacity }}
      >
        {rightHint}
      </motion.div>

      <motion.div
        drag={draggable ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={release}
        style={{ x }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  )
}
