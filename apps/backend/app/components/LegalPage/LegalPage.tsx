'use client'

import { ReactNode } from 'react'
import { Layout } from '../Layout'
import { Footer } from '../Footer'
import { ScrollReveal } from '../ScrollReveal'

interface LegalPageProps {
  eyebrow: string
  title: string
  intro: ReactNode
  updated: string
  children: ReactNode
}

export function LegalPage({ eyebrow, title, intro, updated, children }: LegalPageProps) {
  return (
    <Layout linkBase="/">
      <section className="py-16 lg:py-24 bg-white relative overflow-hidden">
        {/* Soft background glow, same treatment as the Hero */}
        <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
          <img src="/assets/glow/glow.png" alt="" className="w-full h-full object-contain animate-pulse-slow" />
        </div>
        <div className="absolute bottom-[-5%] right-[-10%] w-[600px] h-[600px] pointer-events-none z-0 mix-blend-multiply opacity-40 select-none">
          <img src="/assets/glow/glow.png" alt="" className="w-full h-full object-contain rotate-180" />
        </div>

        <div className="max-w-4xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">

          {/* Title Block */}
          <ScrollReveal direction="up" delay={100} duration={800} triggerOnce>
            <div className="flex flex-col items-start pb-10 mb-12 border-b border-slate-200">
              <span className="text-[#1e3e62] text-xs sm:text-sm font-bold tracking-widest uppercase mb-3 block font-sans">
                {eyebrow}
              </span>
              <h1 className="text-[40px] sm:text-5xl lg:text-[56px] font-bold tracking-tight text-black leading-[1.1] font-display">
                {title}
              </h1>
              <div className="mt-6 max-w-[620px] text-slate-500 font-medium text-sm sm:text-base lg:text-lg leading-relaxed font-sans">
                {intro}
              </div>
              <span className="mt-6 inline-flex items-center rounded-full bg-[#1e3e62]/10 px-4 py-1.5 text-xs font-bold tracking-wide text-[#1e3e62] font-sans">
                Last updated: {updated}
              </span>
            </div>
          </ScrollReveal>

          {/* Content */}
          <div className="flex flex-col gap-14 lg:gap-16">
            {children}
          </div>

        </div>
      </section>
      <Footer linkBase="/" />
    </Layout>
  )
}

const bodyText =
  'flex flex-col gap-4 text-sm sm:text-[15px] font-medium leading-relaxed text-slate-500 font-sans [&_strong]:font-semibold [&_strong]:text-slate-800 [&_a]:font-semibold [&_a]:text-[#1e3e62] [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-black [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ul]:marker:text-[#1e3e62] [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2'

interface LegalSectionProps {
  id?: string
  title: string
  icon?: ReactNode
  children: ReactNode
}

// Icon + heading + body, same pattern as the feature bullets in About
export function LegalSection({ id, title, icon, children }: LegalSectionProps) {
  return (
    <ScrollReveal direction="up" duration={800} triggerOnce>
      <section id={id} className="scroll-mt-28 flex items-start gap-4 sm:gap-5">
        {icon && (
          <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#1e3e62]/10 text-[#1e3e62]">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-bold leading-snug mb-4 text-black font-display">
            {title}
          </h2>
          <div className={bodyText}>{children}</div>
        </div>
      </section>
    </ScrollReveal>
  )
}

interface HighlightItem {
  icon: ReactNode
  title: string
  text: string
}

// "At a glance" card row, hover motion matches the FAQ cards
export function LegalHighlights({ items }: { items: HighlightItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
      {items.map((item, idx) => (
        <ScrollReveal key={item.title} direction="up" delay={idx * 150} duration={800} triggerOnce>
          <div className="h-full rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#1e3e62]/10 text-[#1e3e62]">
              {item.icon}
            </div>
            <h3 className="text-[17px] sm:text-lg font-bold text-black font-display mb-1.5 leading-snug">
              {item.title}
            </h3>
            <p className="text-slate-500 font-medium text-sm leading-relaxed font-sans">{item.text}</p>
          </div>
        </ScrollReveal>
      ))}
    </div>
  )
}

interface TableRow {
  label: string
  detail: string
}

// Two-column list for "what we collect": label on the left, plain-language detail on the right
export function LegalTable({ rows }: { rows: TableRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm">
      {rows.map((row, idx) => (
        <div
          key={row.label}
          className={`grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-1 sm:gap-6 px-5 py-4 sm:px-6 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
        >
          <span className="text-sm font-bold text-[#1e3e62] font-sans">{row.label}</span>
          <span className="text-sm leading-relaxed text-slate-500 font-medium font-sans">{row.detail}</span>
        </div>
      ))}
    </div>
  )
}

interface LegalCalloutProps {
  title: string
  icon?: ReactNode
  children: ReactNode
}

// Dark card, same treatment as the FAQ highlight cards
export function LegalCallout({ title, icon, children }: LegalCalloutProps) {
  return (
    <ScrollReveal direction="up" duration={800} triggerOnce>
      <div className="bg-[#0B2F61] text-white p-8 sm:p-10 rounded-2xl shadow-sm transition-all duration-300 hover:shadow-md">
        <div className="flex items-center gap-3 mb-5">
          {icon && (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
              {icon}
            </div>
          )}
          <h2 className="text-xl sm:text-2xl font-bold leading-snug text-white font-display">{title}</h2>
        </div>
        <div className="flex flex-col gap-4 text-sm sm:text-[15px] font-medium leading-relaxed text-blue-100/80 font-sans [&_strong]:font-semibold [&_strong]:text-white [&_a]:font-semibold [&_a]:text-white [&_a]:underline [&_a]:underline-offset-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2">
          {children}
        </div>
      </div>
    </ScrollReveal>
  )
}
