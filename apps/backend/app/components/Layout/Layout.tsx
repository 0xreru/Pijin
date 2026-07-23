import { ReactNode, useEffect } from 'react'
import { Navbar } from '../Navbar'
import { ReactLenis, useLenis } from 'lenis/react'
import 'lenis/dist/lenis.css'

interface LayoutProps {
  children: ReactNode
}

function LayoutContent({ children }: { children: ReactNode }) {
  const lenis = useLenis()

  useEffect(() => {
    if (!lenis) return

    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null
      if (!target) return

      const href = target.getAttribute('href')
      const hash = target.hash
      
      // If href is just "#" or is empty
      if (href === '#' || href === '') {
        e.preventDefault()
        lenis.scrollTo(0, { duration: 1.2 })
        return
      }

      // For specific section anchors
      if (hash) {
        const element = document.querySelector(hash) as HTMLElement | null
        if (element) {
          e.preventDefault()
          lenis.scrollTo(element, { duration: 2, offset: -80 })
        }
      }
    }

    document.addEventListener('click', handleAnchorClick)
    return () => document.removeEventListener('click', handleAnchorClick)
  }, [lenis])

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
      <Navbar />
      <main className="flex-grow pt-20 md:pt-24">
        {children}
      </main>
    </div>
  )
}

export function Layout({ children }: LayoutProps) {
  return (
    <ReactLenis root options={{ lerp: 0.1, duration: 3, smoothWheel: true }}>
      <LayoutContent>{children}</LayoutContent>
    </ReactLenis>
  )
}


