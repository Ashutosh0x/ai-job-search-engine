"use client"
import { cn } from '@/lib/utils'
import { motion, useInView } from 'framer-motion'
import * as React from 'react'

export function WordsPullUp({
  text,
  className = '',
}: {
  text: string
  className?: string
}) {
  const words = text.split(' ')

  const pullupVariant = {
    initial: { y: 20, opacity: 0 },
    animate: (i: number) => ({
      y: 0,
      opacity: 1,
      transition: {
        delay: i * 0.1,
      },
    }),
  }
  const ref = React.useRef<HTMLDivElement | null>(null)
  const isInView = useInView(ref, { once: true })
  return (
    <div ref={ref} className="flex flex-wrap justify-center">
      {words.map((current, i) => (
        <motion.div
          key={`${current}-${i}`}
          variants={pullupVariant}
          initial="initial"
          animate={isInView ? 'animate' : ''}
          custom={i}
          className={cn(
            'text-xl text-center sm:text-4xl font-bold tracking-tighter md:text-6xl md:leading-[4rem]',
            'pr-2',
            className
          )}
        >
          {current === '' ? <span>&nbsp;</span> : current}
        </motion.div>
      ))}
    </div>
  )
}


