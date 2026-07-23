import { WifiOff, Smartphone, BadgeCheck, ArrowLeftRight, Lock } from 'lucide-react'
import { ScrollReveal } from '../ScrollReveal'

export function About() {
  return (
    <section id="about" className="py-20 lg:py-28 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="space-y-28 lg:space-y-40">

          {/* Section 1: FEATURES */}
          <div id="features" className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            {/* Phone Mockup Column */}
            <ScrollReveal
              direction="left"
              delay={100}
              duration={900}
              className="lg:col-span-6 flex justify-center relative select-none pointer-events-none"
            >
              {/* Soft background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
                <img
                  src="/assets/glow/glow.png"
                  alt=""
                  className="w-full h-full object-contain animate-pulse-slow"
                />
              </div>

              {/* Phone Image */}
              <img
                src="/assets/about/about-1.png"
                alt="Pijin Features Mockup"
                className="w-full max-w-[560px] lg:scale-[1.15] lg:origin-center h-auto object-contain z-10 relative"
              />
            </ScrollReveal>

            {/* Copy Column */}
            <div className="lg:col-span-6 flex flex-col items-start text-left relative z-10">
              <ScrollReveal direction="right" delay={100} duration={800}>
                <span className="text-xs sm:text-sm font-bold tracking-widest text-[#1e3e62] uppercase mb-2 font-sans">
                  FEATURES
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-black leading-tight mb-8 font-display tracking-tight">
                  Pijin
                </h2>
              </ScrollReveal>

              {/* Bullets */}
              <div className="space-y-8 w-full">
                {/* Bullet 1 */}
                <ScrollReveal direction="right" delay={200} duration={800}>
                  <div className="flex items-start space-x-4">
                    <div className="mt-1 flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      <WifiOff className="w-5 h-5 text-[#1e3e62]" />
                    </div>
                    <div>
                      <h3 className="text-[17px] sm:text-lg font-bold text-black font-display mb-1.5 leading-snug">
                        100% Internet-Free For Users
                      </h3>
                      <p className="text-slate-500 font-medium text-sm sm:text-[15px] leading-relaxed max-w-[540px] font-sans">
                        Complete transactions at local shops, transport lines, or markets without needing mobile data load, an active internet connection, or WiFi.
                      </p>
                    </div>
                  </div>
                </ScrollReveal>

                {/* Bullet 2 */}
                <ScrollReveal direction="right" delay={350} duration={800}>
                  <div className="flex items-start space-x-4">
                    <div className="mt-1 flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-[#1e3e62]" />
                    </div>
                    <div>
                      <h3 className="text-[17px] sm:text-lg font-bold text-black font-display mb-1.5 leading-snug">
                        Zero Hardware Barriers
                      </h3>
                      <p className="text-slate-500 font-medium text-sm sm:text-[15px] leading-relaxed max-w-[540px] font-sans">
                        There is absolutely no need to purchase expensive point-of-sale terminals, credit card machines, or new smartphones. The platform is engineered to run smoothly on the mobile devices your business already owns.
                      </p>
                    </div>
                  </div>
                </ScrollReveal>

                {/* Bullet 3 */}
                <ScrollReveal direction="right" delay={500} duration={800}>
                  <div className="flex items-start space-x-4">
                    <div className="mt-1 flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      <BadgeCheck className="w-5 h-5 text-[#1e3e62]" />
                    </div>
                    <div>
                      <h3 className="text-[17px] sm:text-lg font-bold text-black font-display mb-1.5 leading-snug">
                        Real-Time Guaranteed Settlement
                      </h3>
                      <p className="text-slate-500 font-medium text-sm sm:text-[15px] leading-relaxed max-w-[540px] font-sans">
                        Say goodbye to the financial risks of delayed settlements. Every transaction is verified on-chain in seconds, protecting small businesses from double-spend fraud.
                      </p>
                    </div>
                  </div>
                </ScrollReveal>
              </div>
            </div>
          </div>

          {/* Section 2: ADVANTAGES - Part 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            {/* Copy Column */}
            <ScrollReveal
              direction="left"
              delay={100}
              duration={900}
              className="lg:col-span-6 flex flex-col items-start text-left order-2 lg:order-1 relative z-10"
            >
              <span className="text-xs sm:text-sm font-bold tracking-widest text-[#1e3e62] uppercase mb-2 font-sans">
                ADVANTAGES
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-black leading-tight mb-8 font-display tracking-tight">
                Why Choose Pijin?
              </h2>

              <div className="flex items-center space-x-4 mb-4">
                <div className="h-11 w-11 rounded-full bg-[#1e3e62] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <ArrowLeftRight className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-black font-display">
                  Seamless Transaction
                </h3>
              </div>
              <p className="text-slate-500 font-medium text-sm sm:text-base leading-relaxed max-w-[540px] font-sans">
                Transact effortlessly anytime, anywhere—even without mobile data or internet connectivity allowing users to complete transactions with the simplicity of sending a text message.
              </p>
            </ScrollReveal>

            {/* Phone Mockup Column */}
            <ScrollReveal
              direction="right"
              delay={200}
              duration={900}
              className="lg:col-span-6 flex justify-center order-1 lg:order-2 relative select-none pointer-events-none"
            >
              {/* Soft background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
                <img
                  src="/assets/glow/glow.png"
                  alt=""
                  className="w-full h-full object-contain rotate-90 animate-pulse-slow"
                />
              </div>

              {/* Phone Image */}
              <img
                src="/assets/about/about-2.png"
                alt="Pijin Transaction Mockup"
                className="w-full max-w-[560px] lg:scale-[1.15] lg:origin-center h-auto object-contain z-10 relative"
              />
            </ScrollReveal>
          </div>

          {/* Section 3: ADVANTAGES - Part 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            {/* Phone Mockup Column */}
            <ScrollReveal
              direction="left"
              delay={100}
              duration={900}
              className="lg:col-span-6 flex justify-center relative select-none pointer-events-none"
            >
              {/* Soft background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
                <img
                  src="/assets/glow/glow.png"
                  alt=""
                  className="w-full h-full object-contain rotate-180 animate-pulse-slow"
                />
              </div>

              {/* Phone Image */}
              <img
                src="/assets/about/about-3.png"
                alt="Pijin Security Mockup"
                className="w-full max-w-[560px] lg:scale-[1.15] lg:origin-center h-auto object-contain z-10 relative"
              />
            </ScrollReveal>

            {/* Copy Column */}
            <ScrollReveal
              direction="right"
              delay={200}
              duration={900}
              className="lg:col-span-6 flex flex-col items-start text-left relative z-10"
            >
              <div className="flex items-center space-x-4 mb-4">
                <div className="h-11 w-11 rounded-full bg-[#1e3e62] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Lock className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-black font-display">
                  Secure And Reliable
                </h3>
              </div>
              <p className="text-slate-500 font-medium text-sm sm:text-base leading-relaxed max-w-[540px] font-sans">
                Your capital is protected by state-of-the-art decentralized cryptography. Every interaction utilizes advanced, single-use token validation to completely eliminate transaction duplication and fraud, backed by automated holding windows that guarantee safe settlement for both parties
              </p>
            </ScrollReveal>
          </div>

        </div>
      </div>
    </section>
  )
}

