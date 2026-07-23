import { ReactNode, useEffect, useRef, useState } from 'react'

interface ScrollRevealProps {
  children: ReactNode
  direction?: 'up' | 'down' | 'left' | 'right' | 'scale' | 'none'
  delay?: number // in milliseconds
  duration?: number // in milliseconds
  className?: string
  threshold?: number
  triggerOnce?: boolean
}

export function ScrollReveal({
  children,
  direction = 'up',
  delay = 0,
  duration = 800,
  className = '',
  threshold = 0.05,
  triggerOnce = false,
}: ScrollRevealProps) {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsIntersecting(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true)
          if (triggerOnce && ref.current) {
            observer.unobserve(ref.current)
          }
        } else if (!triggerOnce) {
          setIsIntersecting(false)
        }
      },
      { threshold }
    )

    const currentRef = ref.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [threshold, triggerOnce])

  const getDirectionClass = () => {
    switch (direction) {
      case 'up':
        return 'translate-y-12'
      case 'down':
        return '-translate-y-12'
      case 'left':
        return 'translate-x-12'
      case 'right':
        return '-translate-x-12'
      case 'scale':
        return 'scale-[0.95]'
      case 'none':
      default:
        return ''
    }
  }

  const initialClass = `opacity-0 ${getDirectionClass()}`
  const activeClass = 'opacity-100 translate-y-0 translate-x-0 scale-100'

  return (
    <div
      ref={ref}
      className={`transition-all ease-out ${
        isIntersecting ? activeClass : initialClass
      } ${className}`}
      style={{
        transitionDuration: isIntersecting ? `${duration}ms` : '0ms',
        transitionDelay: isIntersecting ? `${delay}ms` : '0ms',
      }}
    >
      {children}
    </div>
  )
}
