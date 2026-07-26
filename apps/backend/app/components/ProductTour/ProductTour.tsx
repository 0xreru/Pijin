'use client'

import { useState } from 'react'
import { ScrollReveal } from '../ScrollReveal'

export function ProductTour() {
  const [isPlaying, setIsPlaying] = useState(false)

  return (
    <section id="tour" className="py-20 lg:py-32 bg-white relative overflow-hidden">

      {/* Decorative glow orb — consistent with Hero and About sections */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] pointer-events-none z-0 mix-blend-multiply opacity-30 select-none">
        <img
          src="/assets/glow/glow.png"
          alt=""
          className="w-full h-full object-contain animate-pulse-slow"
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">

        {/* Section Header — centered, consistent with MeetTheTeam pattern */}
        <div className="flex flex-col items-center text-center mb-12 lg:mb-16">
          <ScrollReveal direction="up" delay={100} duration={800}>
            <span className="text-[#1e3e62] text-xs sm:text-sm font-bold tracking-widest uppercase mb-3 block font-sans">
              PRODUCT DEMO
            </span>
          </ScrollReveal>

          <ScrollReveal direction="up" delay={200} duration={800}>
            <h2 className="text-[36px] sm:text-5xl lg:text-[52px] font-bold tracking-tight text-black leading-tight font-display max-w-2xl">
              Watch How It Works
            </h2>
          </ScrollReveal>

          <ScrollReveal direction="up" delay={300} duration={800}>
            <p className="text-slate-500 font-medium text-sm sm:text-base lg:text-lg mt-4 leading-relaxed max-w-[580px] font-sans">
              See a complete, real-world offline payment — from initiation to guaranteed on-chain settlement — without a single byte of mobile data.
            </p>
          </ScrollReveal>
        </div>

        {/* Video Player Container */}
        <ScrollReveal direction="up" delay={200} duration={900}>
          <div className="relative max-w-4xl mx-auto">

            {/* Video frame — fixed height on mobile to give Google Drive's player
                enough room for its internal toolbar + controls (~85px overhead).
                aspect-video kicks back in on sm+ screens where there is sufficient width. */}
            <div className="relative w-full h-[300px] sm:h-auto sm:aspect-video rounded-2xl overflow-hidden shadow-xl ring-1 ring-slate-200/70 bg-slate-900">

              {/* Facade — thumbnail + minimal play button (shown before user clicks) */}
              {!isPlaying && (
                <button
                  type="button"
                  onClick={() => setIsPlaying(true)}
                  className="absolute inset-0 w-full h-full group cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1e3e62]/50"
                  aria-label="Play Pijin product demo video"
                >
                  {/* Poster thumbnail */}
                  <img
                    src="/assets/product_demo/thumbnail_plain.png"
                    alt="Pijin product demo — click to play"
                    className="w-full h-full object-cover"
                    draggable={false}
                  />

                  {/* Subtle hover scrim */}
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors duration-200" />

                  {/* Play button — centered, simple, no animation per design spec */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-16 h-16 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:bg-white group-hover:scale-105 transition-all duration-200">
                      <svg
                        className="w-7 h-7 fill-[#1e3e62] ml-0.5 flex-shrink-0"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </button>
              )}

              {/* Iframe — only mounted after user clicks play.
                  The click event satisfies the browser's user-gesture requirement,
                  allowing Google Drive's native player to begin playback. */}
              {isPlaying && (
                <iframe
                  src="https://drive.google.com/file/d/1apdqtdCQXend8ix1TuvLHyV1_jX3YFgb/preview?autoplay=1"
                  title="Pijin Product Demo"
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen"
                  tabIndex={-1}
                  aria-label="Pijin 4-minute product demo video"
                />
              )}

            </div>

            {/* Duration badge + tagline row */}
            <div className="flex items-center justify-center gap-3 mt-5">
              <span className="inline-flex items-center gap-1.5 bg-[#1e3e62] text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full uppercase tracking-wider shadow-sm select-none">
                <svg
                  className="w-3 h-3 fill-current flex-shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                4 min watch
              </span>
              <span className="text-slate-400 text-xs font-medium font-sans tracking-wide">
                Built for places internet forgets
              </span>
            </div>

          </div>
        </ScrollReveal>

      </div>
    </section>
  )
}
