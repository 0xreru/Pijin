"use client";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Monitor,
  PlayCircle,
  ShieldCheck,
  Smartphone,
  WalletCards,
  WifiOff,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimDemoSession,
  demoAccessCode,
  DEMO_SESSION_STORAGE_KEY,
  type DemoSessionPayload,
} from '../demo/demo-session-client';
import {
  DEMO_REFRESH_TYPE,
  isDemoEvent,
  type DemoEvent,
  type DemoRole,
} from '../demo/demo-events';

const slides = [
  {
    eyebrow: 'A focused proof of value',
    title: 'Keep money moving when connectivity cannot.',
    description:
      'This environment makes Pijin’s essential payment journey tangible for the businesses and communities that cannot afford to stop when mobile data does.',
    icon: WifiOff,
    detail: null,
  },
  {
    eyebrow: 'What you can experience',
    title: 'One demo. Three core money movements.',
    description:
      'Use the two isolated phones to follow the operational flow from available funds to an offline payment between users.',
    icon: WalletCards,
    detail: (
      <div className="grid w-full gap-3 sm:grid-cols-3">
        {[
          ['01', 'Top up', 'Add PHPC to a demo wallet'],
          ['02', 'Load offline funds', 'Prepare value for offline use'],
          ['03', 'Transfer offline', 'Move value from Phone 1 to Phone 2'],
        ].map(([step, label, copy]) => (
          <div
            key={step}
            className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 text-left"
          >
            <span className="font-sans text-xs font-bold text-[#1e3e62]">{step}</span>
            <p className="mt-2 font-display text-sm font-bold text-black">{label}</p>
            <p className="mt-1 font-sans text-xs font-medium leading-relaxed text-slate-500">
              {copy}
            </p>
          </div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Purpose-built demo scope',
    title: 'A safe look at the core—using free project resources.',
    description:
      'The public environment concentrates on top-up, loading offline funds, and offline transfer. Live SMS is intentionally unavailable because this project uses free resources and protects the security of the demonstration.',
    icon: ShieldCheck,
    detail: (
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 text-left">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#1e3e62]" />
          <div>
            <p className="font-display text-sm font-bold text-black">Android first</p>
            <p className="mt-1 font-sans text-xs font-medium leading-relaxed text-slate-500">
              The current application experience is available on Android OS.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 text-left">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-[#1e3e62]" />
          <div>
            <p className="font-display text-sm font-bold text-black">SMS excluded here</p>
            <p className="mt-1 font-sans text-xs font-medium leading-relaxed text-slate-500">
              The simulator preserves the workflow without exposing a live SMS service.
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    eyebrow: 'See the complete story',
    title: 'Explore the system, then put the core flow to work.',
    description:
      'Open the four-minute product tour for the full product breakdown, then use this hands-on environment to validate the experience for yourself.',
    icon: PlayCircle,
    detail: (
      <a
        href="/#tour"
        target="_blank"
        rel="noreferrer"
        className="group flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-left transition-all duration-300 hover:border-[#1e3e62]/30 hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3e62] focus-visible:ring-offset-2"
      >
        <span>
          <span className="block font-display text-sm font-bold text-black">
            Watch the product tour
          </span>
          <span className="mt-1 block font-sans text-xs font-medium leading-relaxed text-slate-500">
            Keep it open beside the simulator for context as you test.
          </span>
        </span>
        <ArrowRight className="ml-4 h-5 w-5 shrink-0 text-[#1e3e62] transition-transform group-hover:translate-x-1" />
      </a>
    ),
  },
] as const;

export default function SplitSimulatorPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [desktopConfirmed, setDesktopConfirmed] = useState(false);
  const [toasts, setToasts] = useState<DemoEvent[]>([]);
  const touchStartX = useRef<number | null>(null);
  const phone1Ref = useRef<HTMLIFrameElement | null>(null);
  const phone2Ref = useRef<HTMLIFrameElement | null>(null);
  const lastSlideIndex = slides.length - 1;

  const showSlide = useCallback((index: number) => {
    setActiveSlide(Math.max(0, Math.min(index, slides.length - 1)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      await Promise.resolve();
      const raw = sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY);
      if (!cancelled && raw) {
        try {
          const session = JSON.parse(raw) as DemoSessionPayload;
          setSessionId(session.sessionId);
        } catch {
          sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
        }
      }
      if (!cancelled) setRestoring(false);
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const handlePhoneEvent = (message: MessageEvent) => {
      if (message.origin !== window.location.origin || !isDemoEvent(message.data)) {
        return;
      }
      const expectedRole: DemoRole | null =
        message.source === phone1Ref.current?.contentWindow
          ? 'sender'
          : message.source === phone2Ref.current?.contentWindow
            ? 'receiver'
            : null;
      if (
        !expectedRole ||
        message.data.role !== expectedRole ||
        message.data.sessionId !== sessionId
      ) {
        return;
      }

      setToasts((current) => {
        const next = [
          message.data,
          ...current.filter(
            (toast) =>
              !(toast.id === message.data.id && toast.role === message.data.role),
          ),
        ];
        return next.slice(0, 6);
      });

      for (const frame of [phone1Ref.current, phone2Ref.current]) {
        frame?.contentWindow?.postMessage(
          { type: DEMO_REFRESH_TYPE, sessionId },
          window.location.origin,
        );
      }

      if (message.data.phase !== 'pending') {
        window.setTimeout(() => {
          setToasts((current) =>
            current.filter(
              (toast) =>
                !(toast.id === message.data.id && toast.role === message.data.role),
            ),
          );
        }, 5000);
      }
    };
    window.addEventListener('message', handlePhoneEvent);
    return () => window.removeEventListener('message', handlePhoneEvent);
  }, [sessionId]);

  const startSession = async () => {
    if (!desktopConfirmed || activeSlide !== lastSlideIndex) return;
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const accessCode = demoAccessCode(searchParams);
      const nextSessionId = crypto.randomUUID();
      const session = await claimDemoSession(nextSessionId, accessCode);
      sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(session));
      setSessionId(nextSessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start demo session');
    } finally {
      setLoading(false);
    }
  };

  if (restoring) {
    return (
      <main className="min-h-screen bg-[#111111] flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-white px-4 py-6 text-slate-900 sm:px-8 sm:py-8 lg:px-12">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-44 -top-52 h-[620px] w-[620px] opacity-65 mix-blend-multiply">
            <Image
              src="/assets/glow/glow.png"
              alt=""
              width={530}
              height={422}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="absolute -bottom-72 -right-48 h-[700px] w-[700px] rotate-180 opacity-40 mix-blend-multiply">
            <Image
              src="/assets/glow/glow.png"
              alt=""
              width={530}
              height={422}
              className="h-full w-full object-contain"
            />
          </div>
        </div>

        <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col sm:min-h-[calc(100vh-4rem)]">
          <header className="flex items-center justify-between">
            <Link
              href="/"
              className="group flex items-center space-x-2 rounded-lg py-1 pr-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
              aria-label="Pijin home"
            >
              <Image
                src="/assets/logo.png"
                alt=""
                width={28}
                height={28}
                priority
                className="h-7 w-7 object-contain transition-transform duration-300 group-hover:scale-110"
              />
              <span className="flex items-start font-display text-xl font-bold leading-none tracking-tight text-black">
                Pijin
                <span className="ml-0.5 mt-0.5 text-[9px] font-bold leading-none">™</span>
              </span>
            </Link>
            <span className="rounded-full bg-[#1e3e62] px-3.5 py-1.5 font-sans text-[10px] font-bold uppercase tracking-wider text-white shadow-sm sm:text-[11px]">
              Stellar Testnet
            </span>
          </header>

          <section
            className="my-auto py-8 sm:py-10"
            aria-roledescription="carousel"
            aria-label="About the Pijin demo"
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') showSlide(activeSlide - 1);
              if (event.key === 'ArrowRight') showSlide(activeSlide + 1);
            }}
            onTouchStart={(event) => {
              touchStartX.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = touchStartX.current;
              const end = event.changedTouches[0]?.clientX;
              touchStartX.current = null;
              if (start === null || end === undefined || Math.abs(start - end) < 45) return;
              showSlide(activeSlide + (start > end ? 1 : -1));
            }}
            tabIndex={0}
          >
            <div className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-slate-200/70 bg-white/90 shadow-xl ring-1 ring-slate-100 backdrop-blur-sm">
              <div
                className="flex transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transform: `translateX(-${activeSlide * 100}%)` }}
              >
                {slides.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <article
                      key={item.title}
                      className="flex min-h-[390px] w-full shrink-0 flex-col items-center justify-center px-6 py-10 text-center sm:min-h-[430px] sm:px-12"
                      aria-hidden={index !== activeSlide}
                      inert={index !== activeSlide}
                    >
                      <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#1e3e62] text-white shadow-sm">
                        <Icon className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <p className="font-sans text-xs font-bold uppercase tracking-widest text-[#1e3e62]">
                        {item.eyebrow}
                      </p>
                      <h1 className="mt-3 max-w-2xl font-display text-[32px] font-bold leading-[1.08] tracking-tight text-black sm:text-[42px]">
                        {item.title}
                      </h1>
                      <p className="mt-4 max-w-xl font-sans text-sm font-medium leading-relaxed text-slate-500 sm:text-base">
                        {item.description}
                      </p>
                      {item.detail && (
                        <div className="mt-7 w-full max-w-2xl">{item.detail}</div>
                      )}
                      {index === 0 && (
                        <p className="mt-7 font-display text-sm font-bold italic text-black sm:text-base">
                          “bringing digital money within reach, even offline”
                        </p>
                      )}
                      {index === lastSlideIndex && (
                        <div className="mt-6 w-full max-w-2xl">
                          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#1e3e62]/15 bg-[#1e3e62]/[0.045] px-4 py-3 text-left transition-colors duration-300 hover:border-[#1e3e62]/30">
                            <input
                              type="checkbox"
                              checked={desktopConfirmed}
                              onChange={(event) =>
                                setDesktopConfirmed(event.target.checked)
                              }
                              className="mt-1 h-4 w-4 shrink-0 accent-[#1e3e62]"
                            />
                            <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-[#1e3e62]" />
                            <span>
                              <span className="block font-display text-sm font-bold text-black">
                                Desktop view is required
                              </span>
                              <span className="mt-0.5 block font-sans text-xs font-medium leading-relaxed text-slate-500">
                                I am using a desktop browser, or I enabled “Desktop
                                site” on mobile, so both phones remain usable side by
                                side.
                              </span>
                            </span>
                          </label>

                          {error && (
                            <p
                              role="alert"
                              className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700"
                            >
                              {error}
                            </p>
                          )}

                          <button
                            type="button"
                            disabled={loading || !desktopConfirmed}
                            onClick={startSession}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-black px-7 py-3.5 font-sans text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:scale-[1.01] hover:bg-slate-900 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:scale-100 disabled:opacity-40"
                          >
                            {loading
                              ? 'Preparing Testnet Accounts...'
                              : 'ENTER THE DEMO ENVIRONMENT'}
                            {!loading && <ArrowRight className="h-5 w-5" />}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-slate-200/70 px-5 py-4 sm:px-8">
                <div>
                  {activeSlide > 0 && (
                    <button
                      type="button"
                      onClick={() => showSlide(activeSlide - 1)}
                      className="inline-flex h-11 items-center gap-1 rounded-md px-3 font-sans text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3e62]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>
                  )}
                </div>

                <div
                  className="flex items-center gap-2"
                  aria-label={`Step ${activeSlide + 1} of ${slides.length}`}
                >
                  {slides.map((item, index) => (
                    <span
                      key={item.title}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        index === activeSlide ? 'w-7 bg-[#1e3e62]' : 'w-1.5 bg-slate-300'
                      }`}
                      aria-hidden="true"
                    />
                  ))}
                  <span className="sr-only">
                    Step {activeSlide + 1} of {slides.length}
                  </span>
                </div>

                <div className="flex justify-end">
                  {activeSlide < lastSlideIndex && (
                    <button
                      type="button"
                      onClick={() => showSlide(activeSlide + 1)}
                      className="inline-flex h-11 items-center gap-1 rounded-md bg-black px-5 font-sans text-sm font-semibold text-white transition-all duration-300 hover:bg-slate-900 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                    >
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const encodedSession = encodeURIComponent(sessionId);
  return (
    <div className="min-h-screen bg-[#111111] flex flex-col items-center justify-center py-6 overflow-hidden">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-black text-white tracking-tight">Pijin P2P Simulation</h1>
        <p className="text-neutral-400 font-medium mt-1">Isolated Judge Session</p>
      </div>

      <ToastRail
        role="sender"
        toasts={toasts.filter((toast) => toast.role === 'sender').slice(0, 3)}
      />
      <div
        className="flex flex-row items-center justify-center gap-8 md:gap-16 w-full"
        style={{
          transform: 'scale(min(1, min(100vw / 1000, 100vh / 1050)))',
          transformOrigin: 'top center',
        }}
      >
        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Phone 1</p>
          <iframe
            ref={phone1Ref}
            src={`/demo?role=sender&session=${encodedSession}`}
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
            title="Pijin Phone 1 simulator"
          />
        </div>

        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Phone 2</p>
          <iframe
            ref={phone2Ref}
            src={`/demo?role=receiver&session=${encodedSession}`}
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
            title="Pijin Phone 2 simulator"
          />
        </div>
      </div>
      <ToastRail
        role="receiver"
        toasts={toasts.filter((toast) => toast.role === 'receiver').slice(0, 3)}
      />
    </div>
  );
}

function ToastRail({ role, toasts }: { role: DemoRole; toasts: DemoEvent[] }) {
  const phoneLabel = role === 'sender' ? 'Phone 1' : 'Phone 2';
  return (
    <div
      className={`fixed top-1/2 z-50 flex w-64 -translate-y-1/2 flex-col gap-3 ${
        role === 'sender' ? 'left-5 items-start' : 'right-5 items-end'
      }`}
      aria-live="polite"
      aria-label={`${phoneLabel} notifications`}
    >
      {toasts.map((toast) => (
        <div
          key={`${toast.role}:${toast.id}`}
          className={`w-full rounded-2xl border bg-white p-4 font-sans text-left shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 ${
            toast.phase === 'error'
              ? 'border-red-200'
              : toast.phase === 'success'
                ? 'border-emerald-200'
                : 'border-slate-200'
          }`}
        >
          <span className="inline-flex rounded-full bg-[#1e3e62] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            {phoneLabel}
          </span>
          <p className="mt-2 text-sm font-bold text-slate-950">{toast.title}</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
            {toast.message}
          </p>
        </div>
      ))}
    </div>
  );
}
