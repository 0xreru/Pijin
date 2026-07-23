import { Users } from 'lucide-react'
import { ScrollReveal } from '../ScrollReveal'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pt-10 pb-16 lg:pt-14 lg:pb-24">
      {/* Background glow on the left column */}
      <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] pointer-events-none z-0 mix-blend-multiply opacity-85 select-none">
        <img
          src="/assets/glow/glow.png"
          alt=""
          className="w-full h-full object-contain"
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-28 items-center">

          {/* Left Column (Copy and Achievements) */}
          <div className="lg:col-span-6 flex flex-col items-start text-left relative z-10 pt-4 lg:pt-8 order-2 lg:order-1">
            {/* Heading */}
            <ScrollReveal direction="up" delay={100} duration={800}>
              <h1 className="text-[40px] sm:text-5xl lg:text-[60px] font-bold tracking-tight text-black leading-[1.05] font-display mb-5">
                Digital Money Within Reach.
              </h1>
            </ScrollReveal>

            {/* Subtext */}
            <ScrollReveal direction="up" delay={200} duration={800}>
              <p className="text-slate-500 font-medium text-sm sm:text-base lg:text-lg mb-6 leading-relaxed max-w-[620px] font-sans">
                Traditional e-wallets leave millions behind in areas with unstable internet. Pijin breaks the “data-free trap” by allowing you to make secure, real-time digital payments completely without internet
              </p>
            </ScrollReveal>

            {/* CTA Buttons */}
            <ScrollReveal direction="up" delay={300} duration={800}>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 mb-8 lg:mb-10">
                <a
                  href="https://github.com/0xreru/Pijin"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View on GitHub"
                  className="inline-flex items-center justify-center bg-black hover:bg-slate-900 text-white font-semibold px-8 py-3.5 rounded-[4px] gap-2.5 transition-all duration-300 hover:shadow-md hover:scale-[1.02] active:scale-95 text-sm font-sans group"
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

                <a
                  href="#team"
                  className="inline-flex items-center justify-center bg-transparent hover:bg-slate-50 border border-slate-200 text-slate-800 hover:text-black font-semibold px-8 py-3.5 rounded-[4px] gap-2 transition-all duration-300 hover:shadow-sm hover:scale-[1.02] active:scale-95 text-sm font-sans group"
                >
                  <Users className="h-4 w-4 text-slate-500 group-hover:text-black transition-colors" />
                  <span>Team</span>
                </a>
              </div>
            </ScrollReveal>

            {/* Ribbon / Lace component */}
            <ScrollReveal direction="up" delay={400} duration={800}>
              <div className="w-full max-w-[500px] select-none pointer-events-none pr-4">
                <img
                  src="/assets/hero/lace.png"
                  alt="Pijin Achievements and Milestones"
                  className="w-full h-auto object-contain hover:scale-[1.01] transition-transform duration-500"
                />
              </div>
            </ScrollReveal>
          </div>

          {/* Right Column (Mockups) */}
          <ScrollReveal
            direction="right"
            delay={200}
            duration={1000}
            className="lg:col-span-6 relative flex justify-center select-none pointer-events-none mb-8 lg:mb-0 order-1 lg:order-2"
          >
            {/* Soft background glow on the right column to lift the mockups */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[650px] pointer-events-none z-0 mix-blend-multiply opacity-55 select-none">
              <img
                src="/assets/glow/glow.png"
                alt=""
                className="w-full h-full object-contain rotate-180"
              />
            </div>

            {/* Phone mockups */}
            <img
              src="/assets/hero/hero.png"
              alt="Pijin Wallet Mockups"
              className="w-full max-w-[540px] lg:max-w-none max-h-[80vh] lg:max-h-[880px] lg:scale-[1.4] lg:origin-center h-auto object-contain z-10 relative"
            />
          </ScrollReveal>

        </div>
      </div>
    </section>
  )
}

