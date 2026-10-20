'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ code, title, lang }: { code: string; title?: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (insecure origin, permissions); the code stays selectable.
    }
  }

  return (
    <figure className="g-code">
      <figcaption className="g-code-bar">
        <span className="g-code-title">{title ?? lang ?? 'shell'}</span>
        <button type="button" className="g-code-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export type TocItem = { id: string; label: string };

export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const mobileRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [items]);

  function closeMobile() {
    if (mobileRef.current) mobileRef.current.open = false;
  }

  return (
    <>
      <details className="g-toc-mobile" ref={mobileRef}>
        <summary>On this page</summary>
        <TocList items={items} active={active} onNavigate={closeMobile} />
      </details>
      <nav className="g-toc" aria-label="On this page">
        <p className="g-toc-heading">On this page</p>
        <TocList items={items} active={active} />
      </nav>
    </>
  );
}

function TocList({
  items,
  active,
  onNavigate,
}: {
  items: TocItem[];
  active: string | undefined;
  onNavigate?: () => void;
}) {
  return (
    <ol className="g-toc-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} aria-current={active === item.id ? 'location' : undefined} onClick={onNavigate}>
            {item.label}
          </a>
        </li>
      ))}
    </ol>
  );
}
