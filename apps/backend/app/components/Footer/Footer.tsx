import { Mail, Phone } from 'lucide-react'
import { ScrollReveal } from '../ScrollReveal'

export function Footer() {
  return (
    <footer className="bg-white border-t border-slate-100 py-16 lg:py-24 relative overflow-hidden">

      {/* Outer Container */}
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">

        {/* Main Grid: 5 columns on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-10 lg:gap-12 pb-16">

          {/* Column 1: Brand Info */}
          <ScrollReveal direction="up" delay={0} duration={800} className="flex flex-col space-y-4">
            {/* Logo */}
            <a href="#" className="flex items-center space-x-2 group focus:outline-none rounded-lg py-1 pr-2">
              <img
                src="/assets/logo.png"
                alt=""
                className="w-7 h-7 object-contain group-hover:scale-110 transition-transform duration-300"
              />
              <span className="text-xl font-bold tracking-tight text-black font-display leading-none flex items-start">
                Pijin
                <span className="text-[9px] font-bold align-super ml-0.5 leading-none mt-0.5">™</span>
              </span>
            </a>

            {/* Contact Details */}
            <div className="flex flex-col space-y-3 pt-2">
              <a
                href="mailto:Help@pijin.Com"
                className="flex items-center space-x-2.5 text-[15px] font-semibold text-slate-800 hover:text-black transition-colors font-sans"
              >
                <div className="flex items-center justify-center w-5 h-5 text-[#1e3e62]">
                  <Mail className="w-5 h-5" />
                </div>
                <span>Help@Pijin.Com</span>
              </a>

              <a
                href="tel:+123445667889"
                className="flex items-center space-x-2.5 text-[15px] font-semibold text-slate-800 hover:text-black transition-colors font-sans"
              >
                <div className="flex items-center justify-center w-5 h-5 text-[#1e3e62]">
                  <Phone className="w-5 h-5 fill-current" />
                </div>
                <span>+1234 456 678 89</span>
              </a>
            </div>
          </ScrollReveal>

          {/* Column 2: Links */}
          <ScrollReveal direction="up" delay={100} duration={800} className="flex flex-col space-y-4">
            <h4 className="text-xl sm:text-2xl font-bold text-black font-display">Links</h4>
            <nav className="flex flex-col space-y-3 font-sans">
              <a href="#" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Home</a>
              <a href="#about" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">About</a>
              <a href="#team" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Meet the Team</a>
            </nav>
          </ScrollReveal>

          {/* Column 3: Legal */}
          <ScrollReveal direction="up" delay={200} duration={800} className="flex flex-col space-y-4">
            <h4 className="text-xl sm:text-2xl font-bold text-black font-display">Legal</h4>
            <nav className="flex flex-col space-y-3 font-sans">
              <a href="#terms" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Terms Of Use</a>
              <a href="#privacy" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Privacy Policy</a>
              <a href="#cookie" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Cookie Policy</a>
            </nav>
          </ScrollReveal>

          {/* Column 4: Product */}
          <ScrollReveal direction="up" delay={300} duration={800} className="flex flex-col space-y-4">
            <h4 className="text-xl sm:text-2xl font-bold text-black font-display">Product</h4>
            <nav className="flex flex-col space-y-3 font-sans">
              <a href="#tour" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Take Tour</a>
              <a href="#chat" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Live Chat</a>
              <a href="#reviews" className="text-[15px] font-semibold text-slate-800 hover:text-black transition-colors">Reviews</a>
            </nav>
          </ScrollReveal>

          {/* Column 5: Newsletter */}
          <ScrollReveal direction="up" delay={400} duration={800} className="flex flex-col space-y-4 md:col-span-3 lg:col-span-1">
            <h4 className="text-xl sm:text-2xl font-bold text-black font-display">Newsletter</h4>
            <p className="text-[15px] font-semibold text-slate-800 font-sans">Stay Up To Date</p>

            <form onSubmit={(e) => e.preventDefault()} className="flex items-center bg-white border border-slate-200 rounded-lg p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-slate-900 transition-all max-w-md w-full">
              <input
                type="email"
                placeholder="Your email"
                className="flex-grow px-3 py-2 text-sm text-slate-800 placeholder-slate-400 bg-transparent outline-none font-sans"
              />
              <button
                type="submit"
                className="bg-black hover:bg-slate-900 text-white px-6 py-2.5 rounded-md font-sans font-semibold text-sm transition-all duration-300 flex items-center justify-center focus:outline-none"
              >
                Subscribe
              </button>
            </form>
          </ScrollReveal>

        </div>

        {/* Divider Line */}
        <hr className="border-slate-200" />

        {/* Copyright Notice */}
        <div className="py-8 text-center">
          <p className="text-sm font-semibold text-slate-800 font-sans">
            Copyright 2026 Pijin All Rights Reserved
          </p>
        </div>

      </div>

      {/* Decorative Star 1 (Left Star) - placed bottom-left */}
      <ScrollReveal
        direction="scale"
        delay={200}
        duration={1000}
        className="absolute left-4 lg:left-8 bottom-6 w-8 h-8 lg:w-9 lg:h-9 select-none pointer-events-none z-10"
      >
        <img
          src="/assets/star.png"
          alt=""
          className="w-full h-full object-contain opacity-95 animate-pulse-slow"
        />
      </ScrollReveal>

      {/* Decorative Star 2 (Right Star) - placed far-right, level with newsletter */}
      <ScrollReveal
        direction="scale"
        delay={300}
        duration={1000}
        className="absolute right-4 lg:right-8 top-12 lg:top-16 w-8 h-8 lg:w-9 lg:h-9 select-none pointer-events-none z-10"
      >
        <img
          src="/assets/star.png"
          alt=""
          className="w-full h-full object-contain opacity-95 animate-pulse-slow"
        />
      </ScrollReveal>

    </footer>
  )
}

