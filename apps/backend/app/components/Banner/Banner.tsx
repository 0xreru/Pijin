import { ScrollReveal } from '../ScrollReveal'

const AndroidIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0004.5511-.4482.9997-.9993.9997zm-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997zm11.4045-6.02l1.9973-3.4592c.1146-.1986.0467-.4522-.1518-.5672-.1993-.1142-.4526-.0464-.5672.1522l-2.0223 3.503c-1.4727-.6718-3.2383-1.0478-5.1375-1.0478-1.8988 0-3.6645.376-5.1371 1.0478l-2.0227-3.503c-.1146-.1986-.3682-.2664-.5672-.1522-.1986.115-.2664.3686-.1518.5672l1.9973 3.4592C2.656 10.7422.3857 14.1507.0392 18.2573h23.9216c-.3469-4.1066-2.6172-7.5151-6.0333-8.9359z" />
  </svg>
)

export function Banner() {
  return (
    <section className="py-12 lg:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <ScrollReveal direction="up" delay={100} duration={800}>
          <div className="relative bg-gradient-to-br from-[#0B162C] via-[#050B14] to-[#02050A] rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden flex flex-col lg:flex-row items-center justify-between min-h-[400px] lg:min-h-[460px] shadow-2xl">
            
            {/* Glow Effect */}
            <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-[10%] lg:translate-x-1/4 w-[500px] lg:w-[700px] h-[500px] lg:h-[700px] pointer-events-none z-0 opacity-70 select-none">
              <ScrollReveal direction="scale" delay={150} duration={1200} className="w-full h-full">
                <img src="/assets/glow/glow.png" alt="" className="w-full h-full object-contain mix-blend-screen" />
              </ScrollReveal>
            </div>

            {/* Rings in bottom-left */}
            <div className="absolute -left-[150px] sm:-left-[200px] lg:-left-[250px] -bottom-[150px] sm:-bottom-[200px] lg:-bottom-[250px] w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] lg:w-[500px] lg:h-[500px] pointer-events-none z-0 opacity-100 select-none mix-blend-screen">
              <ScrollReveal direction="right" delay={200} duration={1000} className="w-full h-full">
                <img src="/assets/banner/ring.png" alt="" className="w-full h-full object-contain" />
              </ScrollReveal>
            </div>

            {/* Rings in top-right */}
            <div className="absolute -right-[150px] sm:-right-[200px] lg:-right-[250px] -top-[150px] sm:-top-[200px] lg:-top-[250px] w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] lg:w-[500px] lg:h-[500px] pointer-events-none z-0 opacity-100 select-none mix-blend-screen rotate-180">
              <ScrollReveal direction="down" delay={300} duration={1000} className="w-full h-full">
                <img src="/assets/banner/ring.png" alt="" className="w-full h-full object-contain" />
              </ScrollReveal>
            </div>
            
            {/* Stars */}
            {/* Top Center Large Star */}
            <div className="absolute top-8 lg:top-10 left-[40%] lg:left-[45%] w-10 h-10 lg:w-16 lg:h-16 opacity-90 z-0 select-none pointer-events-none invert brightness-0">
              <ScrollReveal direction="down" delay={400} duration={800} className="w-full h-full">
                <img src="/assets/star.png" alt="" className="w-full h-full" />
              </ScrollReveal>
            </div>
            
            {/* Bottom Center Medium Star */}
            <div className="absolute bottom-16 lg:bottom-24 left-[50%] lg:left-[40%] w-6 h-6 lg:w-10 lg:h-10 opacity-80 z-0 select-none pointer-events-none invert brightness-0">
              <ScrollReveal direction="up" delay={550} duration={800} className="w-full h-full">
                <img src="/assets/star.png" alt="" className="w-full h-full" />
              </ScrollReveal>
            </div>

            {/* Top Right Small Star */}
            <div className="absolute top-32 right-[30%] lg:right-[35%] w-5 h-5 lg:w-7 lg:h-7 opacity-70 z-0 select-none pointer-events-none invert brightness-0">
              <ScrollReveal direction="left" delay={700} duration={800} className="w-full h-full">
                <img src="/assets/star.png" alt="" className="w-full h-full" />
              </ScrollReveal>
            </div>

            {/* Left side extra small star */}
            <div className="absolute top-[40%] left-6 lg:left-10 w-4 h-4 opacity-50 z-0 select-none pointer-events-none invert brightness-0">
              <ScrollReveal direction="right" delay={850} duration={800} className="w-full h-full">
                <img src="/assets/star.png" alt="" className="w-full h-full" />
              </ScrollReveal>
            </div>

            {/* Left Column (Copy) */}
            <div className="relative z-10 w-full lg:w-[55%] p-10 sm:p-14 lg:p-16 xl:p-20 flex flex-col items-start text-left">
              <ScrollReveal direction="right" delay={200} duration={800} className="w-full">
                <h2 className="text-[26px] sm:text-[36px] lg:text-[42px] xl:text-[48px] font-bold text-white leading-[1.1] mb-4 sm:mb-5 font-display tracking-tight whitespace-nowrap">
                  Ready To Get Started?
                </h2>
              </ScrollReveal>
              <ScrollReveal direction="right" delay={350} duration={800} className="w-full">
                <p className="text-slate-300 font-medium text-[15px] sm:text-base leading-relaxed mb-8 max-w-[420px] font-sans">
                  Experience digital money within reach. Make secure, real-time digital payments completely without internet.
                </p>
              </ScrollReveal>
              <ScrollReveal direction="up" delay={500} duration={800}>
                <button className="bg-white hover:bg-slate-100 text-black px-6 sm:px-7 py-3.5 rounded-lg font-semibold flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.02] active:scale-95 shadow-sm">
                  <span className="font-sans text-sm sm:text-[15px]">Download App</span>
                  <AndroidIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </ScrollReveal>
            </div>

            {/* Right Column (Phones Image) */}
            <div className="relative z-10 w-full lg:w-[45%] h-[280px] sm:h-[350px] lg:h-full lg:absolute lg:right-0 lg:bottom-0 flex justify-center lg:justify-end items-end pointer-events-none select-none overflow-visible">
              <ScrollReveal direction="left" delay={400} duration={1000} className="w-full h-full flex justify-center lg:justify-end items-end">
                <img 
                   src="/assets/banner/phones.png" 
                   alt="Pijin App" 
                   className="w-auto h-[95%] sm:h-[105%] lg:h-auto lg:w-[115%] lg:max-w-[650px] object-contain object-bottom lg:object-right-bottom transform translate-y-[7%] sm:translate-y-[10%] lg:translate-y-[20%] lg:translate-x-2 xl:translate-x-8" 
                />
              </ScrollReveal>
            </div>

          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
