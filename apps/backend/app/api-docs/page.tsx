'use client';

import { useEffect, useState } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import './swagger.css';

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
    <>
      {/* Header */}
      <header className="api-docs-header">
        <div className="api-docs-logo">P</div>
        <div className="api-docs-title">
          <h1>Pijin API Reference</h1>
          <p>Stellar P2P Offline Payment Engine — Interactive Documentation</p>
        </div>
        <span className="api-docs-badge">v1.0.0 · Testnet</span>
      </header>

      {/* Swagger UI */}
      {error ? (
        <div className="api-docs-error">
          <strong>Failed to load API spec</strong>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>{error}</p>
        </div>
      ) : spec ? (
        <SwaggerUI
          spec={spec}
          docExpansion="list"
          defaultModelsExpandDepth={1}
          displayRequestDuration
          tryItOutEnabled
        />
      ) : (
        <div className="api-docs-loading">
          <div className="api-docs-spinner" />
          <span>Loading API specification…</span>
        </div>
      )}
    </>
  );
}
