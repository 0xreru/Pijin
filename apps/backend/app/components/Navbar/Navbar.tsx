import { useState, useEffect, useRef } from 'react'
import { ArrowUpRight, Menu, X } from 'lucide-react'

interface NavItem {
  label: string
  href: string
}

const navItems: NavItem[] = [
  { label: 'Home', href: '#' },
  { label: 'About', href: '#about' },
  { label: 'Team', href: '#team' },
  { label: 'FAQ', href: '#faq' },
]

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState('#')
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 })
  const isClickScrolling = useRef(false)

  // Smooth scroll click handler to instantly update state and disable scrollspy fighting
  const handleNavLinkClick = (href: string) => {
    setActiveSection(href)
    isClickScrolling.current = true
    setTimeout(() => {
      isClickScrolling.current = false
    }, 850)
  }

  // Track scroll position to update header styling dynamically and active section (scrollspy)
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true)
      } else {
        setIsScrolled(false)
      }

      if (isClickScrolling.current) return

      const scrollPosition = window.scrollY + 120 // offset for navbar height
      const aboutSection = document.getElementById('about')
      const teamSection = document.getElementById('team')
      const faqSection = document.getElementById('faq')

      let currentSection = '#'

      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50) {
        currentSection = '#faq'
      } else if (faqSection && scrollPosition >= faqSection.offsetTop) {
        currentSection = '#faq'
      } else if (teamSection && scrollPosition >= teamSection.offsetTop) {
        currentSection = '#team'
      } else if (aboutSection && scrollPosition >= aboutSection.offsetTop) {
        currentSection = '#about'
      } else {
        currentSection = '#'
      }

      setActiveSection(currentSection)
    }

    // Run once initially
    handleScroll()

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Calculate sliding indicator coordinates dynamically
  useEffect(() => {
    const updateIndicator = () => {
      const activeEl = document.querySelector(
        `nav[aria-label="Desktop Main Navigation"] a[href="${activeSection}"]`
      ) as HTMLElement

      if (activeEl) {
        setIndicatorStyle({
          left: activeEl.offsetLeft,
          width: activeEl.offsetWidth,
          opacity: 1
        })
      } else {
        setIndicatorStyle(prev => ({ ...prev, opacity: 0 }))
      }
    }

    // Run layout measurements
    updateIndicator()

    // Listen to resize events to maintain correct positions
    window.addEventListener('resize', updateIndicator)
    return () => window.removeEventListener('resize', updateIndicator)
  }, [activeSection])

  // Close mobile drawer on resize if screen width exceeds md breakpoint
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <header
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'py-3' : 'py-5'
        } ${isScrolled || isOpen
          ? 'bg-white/40 backdrop-blur-lg shadow-sm'
          : 'bg-transparent'
        }`}
    >
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between">

          {/* Logo & Navigation Section (Left Aligned Together) */}
          <div className="flex items-center">
            {/* Logo */}
            <a
              href="#"
              className="flex items-center space-x-2 group focus:outline-none focus:ring-2 focus:ring-slate-900 rounded-lg py-1 pr-2"
              aria-label="Pijin Home"
            >
              <img
                src="/assets/logo.png"
                alt=""
                className="w-7 h-7 object-contain group-hover:scale-110 transition-transform duration-300"
              />
              {/* Text: bold, clash display font */}
              <span className="text-xl font-bold tracking-tight text-black font-sans leading-none flex items-start">
                Pijin
                <span className="text-[9px] font-bold align-super ml-0.5 leading-none mt-0.5">™</span>
              </span>
            </a>

            {/* Desktop Navigation Links (Left-aligned next to logo) */}
            <nav className="hidden md:flex items-center ml-12 space-x-8 relative" aria-label="Desktop Main Navigation">
              {navItems.map((item) => {
                const isActive = item.href === activeSection
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => handleNavLinkClick(item.href)}
                    className={`text-sm transition-colors duration-200 py-2 font-sans ${isActive
                        ? 'font-bold text-[#1e3e62]'
                        : 'font-medium text-slate-800 hover:text-black'
                      }`}
                  >
                    <span>{item.label}</span>
                  </a>
                )
              })}

              {/* Sliding Active Section Indicator */}
              <span
                style={{
                  transform: `translateX(${indicatorStyle.left}px)`,
                  width: `${indicatorStyle.width}px`,
                  opacity: indicatorStyle.opacity,
                }}
                className="absolute bottom-0 left-0 h-0.5 bg-[#1e3e62] rounded-full transition-all duration-300 ease-in-out pointer-events-none !m-0"
              />
            </nav>
          </div>

          {/* Desktop Documentation and GitHub CTA Buttons (Far Right) */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href="/api-docs"
              aria-label="View API documentation"
              className="inline-flex items-center justify-center text-black font-medium text-sm px-4 py-2.5 rounded-md gap-2 transition-all duration-300 hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 focus:ring-offset-white"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              <span>API Docs</span>
            </a>

            <a
              href="https://github.com/0xreru/Pijin"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              className="inline-flex items-center justify-center bg-black hover:bg-slate-900 text-white font-semibold text-sm px-5 py-2.5 rounded-md gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 focus:ring-offset-white"
            >
              <svg
                className="h-5 w-5 fill-current"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
              </svg>
              <span>README</span>
            </a>
          </div>

          {/* Mobile Menu Toggle Button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-lg text-slate-800 hover:text-black hover:bg-slate-100 border border-slate-200 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
              aria-controls="mobile-menu"
              aria-expanded={isOpen}
              aria-label={isOpen ? 'Close main menu' : 'Open main menu'}
            >
              <div className="relative w-6 h-6 transition-transform duration-300 ease-in-out">
                {isOpen ? (
                  <X className="absolute inset-0 h-6 w-6 transform rotate-90 opacity-100 transition-all duration-300" />
                ) : (
                  <Menu className="absolute inset-0 h-6 w-6 transform rotate-0 opacity-100 transition-all duration-300" />
                )}
              </div>
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Drawer Menu Overlay */}
      <div
        id="mobile-menu"
        className={`md:hidden absolute top-full left-0 w-full bg-white/95 backdrop-blur-xl border-b border-slate-200 transition-all duration-300 ease-in-out origin-top overflow-hidden ${isOpen
            ? 'opacity-100 scale-y-100 pointer-events-auto h-[calc(100vh-68px)]'
            : 'opacity-0 scale-y-95 pointer-events-none h-0'
          }`}
      >
        <div className="px-6 pt-8 pb-10 space-y-8 flex flex-col h-full justify-between max-w-md mx-auto">
          <nav className="flex flex-col space-y-5" aria-label="Mobile Main Navigation">
            {navItems.map((item, idx) => {
              const isActive = item.href === activeSection
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => {
                    handleNavLinkClick(item.href)
                    setIsOpen(false)
                  }}
                  style={{
                    transitionDelay: isOpen ? `${idx * 75}ms` : '0ms',
                  }}
                  className={`text-lg py-3 border-b border-slate-100 hover:border-slate-200 transition-all duration-300 transform font-sans flex items-center justify-between ${isOpen ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
                    } ${isActive ? 'font-bold text-[#1e3e62]' : 'font-medium text-slate-800 hover:text-black'}`}
                >
                  <span>{item.label}</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 bg-[#1e3e62] rounded-full" />
                  )}
                </a>
              )
            })}
          </nav>

          <div
            className={`transition-all duration-500 transform delay-200 ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
          >
            <div className="flex flex-col gap-3">
              <a
                href="/api-docs"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center gap-2 w-full border border-slate-200 bg-white hover:bg-slate-50 text-black font-medium py-3.5 rounded-xl transition-all duration-300 active:scale-[0.99]"
              >
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                <span className="font-sans text-sm">API Docs</span>
              </a>

              <a
                href="https://github.com/0xreru/Pijin"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center space-x-2 w-full bg-black hover:bg-slate-900 text-white font-semibold py-3.5 rounded-xl transition-all duration-300 shadow-sm active:scale-[0.99]"
              >
                <svg
                  className="h-5 w-5 fill-current"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
                </svg>
                <span className="font-sans text-sm tracking-wide">README</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
