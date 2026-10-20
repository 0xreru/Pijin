'use client';

import { useEffect, useState } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import DocsShell from '../components/DocsShell/DocsShell';
import './swagger.css';

const authSchemes = [
  { name: 'SEP-10 JWT', detail: 'GET + POST /api/auth' },
  { name: 'Wallet signature', detail: 'Ed25519 over a canonical message' },
  { name: 'Interactive token', detail: 'SEP-24 webview, 15 min' },
  { name: 'HMAC / QStash', detail: 'Gateway and worker ingress' },
];

export default function ApiDocsPage() {
  const [spec, setSpec] = useState<object | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/swagger')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load spec: ${res.status}`);
        return res.json();
      })
      .then(setSpec)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <DocsShell active="api">
      <section className="pj-hero">
        <div className="pj-hero-inner">
          <span className="pj-eyebrow">API Reference · v1.0.0</span>
          <h1>Pijin API</h1>
          <p className="pj-hero-lead">
            Every endpoint behind the Pijin app: SEP-10 auth, SEP-24 GCash ramps, Soroban vault operations, and the
            SMS → QStash → <code className="api-hero-code">spend_offline</code> settlement pipeline. Use{' '}
            <strong>Try it out</strong> to call the current deployment.
          </p>
          <div className="pj-chips">
            <span className="pj-chip">
              <span className="pj-chip-dot" aria-hidden="true" />
              Stellar Testnet
            </span>
            <span className="pj-chip">OpenAPI 3.0</span>
            <span className="pj-chip">
              <a className="api-hero-link" href="/api/swagger" target="_blank" rel="noopener noreferrer">
                Raw spec (JSON)
              </a>
            </span>
          </div>
          <ul className="api-auth-grid" aria-label="Authentication schemes">
            {authSchemes.map((scheme) => (
              <li key={scheme.name}>
                <strong>{scheme.name}</strong>
                <span>{scheme.detail}</span>
              </li>
            ))}
          </ul>
          <p className="api-hero-note">
            New to the flows? Read the <a href="/docs#integrate">integration guide</a> first.
          </p>
        </div>
      </section>

      <div className="api-docs-body">
        {error ? (
          <div className="api-docs-error" role="alert">
            <strong>Failed to load API spec</strong>
            <p>{error}</p>
          </div>
        ) : spec ? (
          <SwaggerUI
            spec={spec}
            docExpansion="list"
            defaultModelsExpandDepth={-1}
            displayRequestDuration
            deepLinking
            filter
            tryItOutEnabled
          />
        ) : (
          <div className="api-docs-loading" role="status">
            <div className="api-docs-spinner" aria-hidden="true" />
            <span>Loading API specification…</span>
          </div>
        )}
      </div>
    </DocsShell>
  );
}
