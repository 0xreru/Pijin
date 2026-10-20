'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import './docs-shell.css';

type DocsSection = 'guide' | 'api';

const GITHUB_URL = 'https://github.com/0xreru/Pijin';

const links: { id: DocsSection; label: string; href: string }[] = [
  { id: 'guide', label: 'Setup & Integration', href: '/docs' },
  { id: 'api', label: 'API Reference', href: '/api-docs' },
];

export default function DocsShell({
  active,
  children,
}: {
  active: DocsSection;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="pj-docs">
      <a className="pj-skip" href="#pj-main">
        Skip to content
      </a>
      <header className="pj-topbar">
        <div className="pj-topbar-inner">
          <Link href="/" className="pj-brand" aria-label="Pijin home">
            <img src="/icon.png" alt="" width={28} height={28} />
            <span className="pj-brand-name">Pijin</span>
            <span className="pj-brand-tag">Docs</span>
          </Link>

          <nav className="pj-nav" aria-label="Documentation">
            {links.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                className="pj-nav-link"
                aria-current={active === link.id ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="pj-topbar-actions">
            <a className="pj-btn pj-btn-dark" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <GithubIcon />
              <span>GitHub</span>
            </a>
          </div>

          <button
            type="button"
            className="pj-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="pj-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        <div id="pj-mobile-menu" className="pj-mobile-menu" hidden={!menuOpen}>
          {links.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className="pj-mobile-link"
              aria-current={active === link.id ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link className="pj-mobile-link" href="/">
            Pijin website
          </Link>
          <a className="pj-btn pj-btn-dark pj-btn-block" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <GithubIcon />
            <span>View on GitHub</span>
          </a>
        </div>
      </header>

      <div id="pj-main">{children}</div>

      <footer className="pj-footer">
        <div className="pj-footer-inner">
          <span>© 2026 The Pijin Team · Released under the MIT License</span>
          <span className="pj-footer-links">
            <Link href="/">Website</Link>
            <Link href="/docs">Guide</Link>
            <Link href="/api-docs">API</Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
