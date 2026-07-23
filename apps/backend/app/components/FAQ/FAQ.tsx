import { ScrollReveal } from '../ScrollReveal'

interface FAQItem {
  type: 'dark' | 'light'
  question: string
  answer: string
}

const leftColumnFAQs: FAQItem[] = [
  {
    type: 'dark',
    question: 'Do I really need mobile data to make a payment?',
    answer: 'No. you can pay in areas with zero internet or data.'
  },
  {
    type: 'light',
    question: 'Do business owners need to buy special hardware?',
    answer: 'Not at all. The platform runs entirely on standard mobile devices that merchants and consumers already own.'
  },
  {
    type: 'dark',
    question: 'Who is this platform designed for?',
    answer: 'It is built for anyone facing unreliable internet, especially sari-sari stores, wet market vendors, transport operators, and rural households.'
  }
]

const rightColumnFAQs: FAQItem[] = [
  {
    type: 'light',
    question: 'How do merchants verify a payment without internet?',
    answer: 'Merchants receive an instant, secure text confirmation receipt directly to their phone the second the transaction settles'
  },
  {
    type: 'dark',
    question: 'Do I need to understand blockchain or crypto to use it?',
    answer: 'Not at all. The app uses simple, everyday terms like "Online Balance" and "Offline Cash Vault" to completely remove any technical confusion.'
  },
  {
    type: 'light',
    question: 'Do I need to enter long, complicated account numbers to make a payment?',
    answer: 'Not at all. The platform maps accounts to short, simple identifiers to keep your checkout process quick and effortless.'
  }
]

export function FAQ() {
  return (
    <section id="faq" className="py-20 lg:py-32 bg-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">

        {/* Main Grid: Left Column starts with Title block, Right Column starts with FAQ Card */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 lg:gap-x-16 gap-y-10 lg:gap-y-12 items-start">

          {/* Row 1, Col 1: Title Block */}
          <div className="lg:col-start-1">
            <ScrollReveal direction="up" delay={100} duration={800}>
              <div className="flex flex-col items-start">
                <span className="text-[#1e3e62] text-xs sm:text-sm font-bold tracking-widest uppercase mb-3 block font-sans">
                  FAQ
                </span>
                <h2 className="text-[40px] sm:text-5xl lg:text-[56px] font-bold tracking-tight text-black leading-[1.1] font-display">
                  Frequently Asked<br className="hidden sm:inline" /> Questions
                </h2>
              </div>
            </ScrollReveal>
          </div>

          {/* Row 1, Col 2: Empty space on desktop to align cards below */}
          <div className="hidden lg:block lg:col-start-2"></div>

          {/* Row 2, Col 1: Left Column Cards */}
          <div className="flex flex-col gap-10 lg:gap-12 lg:col-start-1">
            {leftColumnFAQs.map((item, idx) => (
              <ScrollReveal key={idx} direction="up" delay={idx * 150 + 100} duration={800}>
                <div
                  className={`transition-all duration-300 ${item.type === 'dark'
                      ? 'bg-[#0B2F61] text-white p-8 sm:p-10 rounded-2xl shadow-sm hover:scale-[1.01] hover:shadow-md'
                      : 'bg-transparent text-black p-0 hover:translate-x-1'
                    }`}
                >
                  <h3
                    className={`text-xl sm:text-2xl font-bold leading-snug mb-4 font-display ${item.type === 'dark' ? 'text-white' : 'text-black'
                      }`}
                  >
                    {item.question}
                  </h3>
                  <p
                    className={`text-sm sm:text-[15px] font-medium leading-relaxed font-sans ${item.type === 'dark' ? 'text-blue-100/80' : 'text-slate-500'
                      }`}
                  >
                    {item.answer}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          {/* Row 2, Col 2: Right Column Cards */}
          <div className="flex flex-col gap-10 lg:gap-12 lg:col-start-2">
            {rightColumnFAQs.map((item, idx) => (
              <ScrollReveal key={idx} direction="up" delay={idx * 150 + 250} duration={800}>
                <div
                  className={`transition-all duration-300 ${item.type === 'dark'
                      ? 'bg-[#0B2F61] text-white p-8 sm:p-10 rounded-2xl shadow-sm hover:scale-[1.01] hover:shadow-md'
                      : 'bg-transparent text-black p-0 hover:translate-x-1'
                    }`}
                >
                  <h3
                    className={`text-xl sm:text-2xl font-bold leading-snug mb-4 font-display ${item.type === 'dark' ? 'text-white' : 'text-black'
                      }`}
                  >
                    {item.question}
                  </h3>
                  <p
                    className={`text-sm sm:text-[15px] font-medium leading-relaxed font-sans ${item.type === 'dark' ? 'text-blue-100/80' : 'text-slate-500'
                      }`}
                  >
                    {item.answer}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>

        </div>

        {/* Decorative Star Image in bottom-left */}
        <ScrollReveal
          direction="scale"
          delay={400}
          duration={1000}
          className="absolute left-4 lg:left-0 xl:-left-6 bottom-4 lg:bottom-10 w-8 h-8 lg:w-10 lg:h-10 select-none pointer-events-none z-10"
        >
          <img
            src="/assets/star.png"
            alt=""
            className="w-full h-full object-contain opacity-95"
          />
        </ScrollReveal>

      </div>
    </section>
  )
}

