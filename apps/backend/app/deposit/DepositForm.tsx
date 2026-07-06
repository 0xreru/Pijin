'use client';

/**
 * @file app/deposit/DepositForm.tsx
 *
 * SEP-24 Interactive Deposit — Client Component (Styled with Native CSS)
 * ───────────────────────────────────────────────────────────────────────
 * Renders the GCash-style payment UI and orchestrates the /api/anchor/simulate-payment
 * POST call. Aligned with Pijin's white-surface/navy-accent theme.
 */

import { useState, useTransition } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepositFormProps {
  transactionId: string;
  assetCode: string;
  stellarAccount: string;
}

type ScreenState = 'idle' | 'submitting' | 'success' | 'error';

// ── Asset display helpers ─────────────────────────────────────────────────────

const ASSET_META: Record<string, { label: string; symbol: string; color: string; hex: string }> = {
  PHPC: {
    label: 'Philippine Peso Coin',
    symbol: '₱',
    color: 'from-[#02132B] to-[#04224C]',
    hex: '#02132B',
  },
  USDC: {
    label: 'USD Coin',
    symbol: '$',
    color: 'from-[#02132B] to-[#04224C]',
    hex: '#02132B',
  },
};

function getAssetMeta(code: string) {
  return (
    ASSET_META[code.toUpperCase()] ?? {
      label: code,
      symbol: '',
      color: 'from-[#02132B] to-[#04224C]',
      hex: '#02132B',
    }
  );
}

// ── Embedded CSS Styles ───────────────────────────────────────────────────────

const STYLE_BLOCK = `
  :root {
    --color-bg: #EFF1F5;
    --color-surface: #FFFFFF;
    --color-primary: #02132B;
    --color-secondary: #04224C;
    --color-navy-dark: #04295A;
    --color-text-main: #08090A;
    --color-text-muted: #707984;
    --color-border: #E6E9EE;
    --color-input-border: #DADADA;
    --color-success: #16C784;
    --color-success-bg: #F0FDF4;
    --color-success-border: #DCFCE7;
    --color-error: #F04438;
    --color-error-bg: #FEF2F2;
    --color-error-border: #FEE2E2;
  }

  body, html {
    background-color: var(--color-bg) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    color: var(--color-text-main) !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 100vh !important;
    box-sizing: border-box !important;
  }

  * {
    box-sizing: border-box !important;
  }

  .min-h-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    width: 100%;
    background-color: var(--color-bg);
  }

  .card-wrapper {
    width: 100%;
    max-width: 380px;
    position: relative;
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 24px;
    box-shadow: 0 10px 30px rgba(4, 41, 90, 0.08);
    overflow: hidden;
    width: 100%;
  }

  .card-header-bar {
    height: 6px;
    background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
    width: 100%;
  }

  .card-content {
    padding: 28px;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }

  .brand-icon {
    display: flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    color: #FFFFFF;
    font-weight: 800;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(2, 19, 43, 0.15);
    flex-shrink: 0;
  }

  .header-text-subtitle {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 0;
  }

  .header-text-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--color-navy-dark);
    margin: 2px 0 0 0;
    line-height: 1.2;
  }

  .wallet-box {
    background: #F5F6F8;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 12px 16px;
    margin-bottom: 24px;
  }

  .wallet-box-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 0 0 4px 0;
  }

  .wallet-box-value {
    font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--color-navy-dark);
    margin: 0;
    word-break: break-all;
  }

  .form-group {
    margin-bottom: 20px;
    text-align: left;
  }

  .form-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }

  .input-container {
    position: relative;
    width: 100%;
  }

  .input-symbol {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    font-weight: 600;
    font-size: 16px;
    pointer-events: none;
  }

  .text-input {
    width: 100%;
    background: var(--color-surface);
    border: 1.5px solid var(--color-input-border);
    border-radius: 12px;
    padding: 14px 16px 14px 36px;
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-main);
    transition: all 0.2s ease;
    outline: none;
  }

  .text-input:focus {
    border-color: var(--color-navy-dark);
    box-shadow: 0 0 0 4px rgba(4, 41, 90, 0.08);
  }

  .text-input::placeholder {
    color: #B4B9C0;
  }

  .alert-box {
    display: flex;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 12px;
    margin-bottom: 20px;
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
  }

  .alert-danger {
    background: var(--color-error-bg);
    border: 1px solid var(--color-error-border);
    color: var(--color-error);
  }

  .alert-success {
    background: var(--color-success-bg);
    border: 1px solid var(--color-success-border);
    color: var(--color-success);
  }

  .btn-primary {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    color: #FFFFFF;
    font-weight: 700;
    font-size: 15px;
    padding: 16px 20px;
    border-radius: 14px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(2, 19, 43, 0.18);
    transition: all 0.2s ease;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.95;
    transform: translateY(-1px);
  }

  .btn-primary:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .footer-text {
    text-align: center;
    font-size: 11px;
    color: var(--color-text-muted);
    line-height: 1.5;
    margin-top: 24px;
  }

  .powered-by {
    text-align: center;
    font-size: 11px;
    color: var(--color-text-muted);
    margin-top: 16px;
  }

  .powered-by-brand {
    color: var(--color-navy-dark);
    font-weight: 700;
  }

  .success-icon-wrapper {
    margin: 0 auto 24px auto;
    display: flex;
    width: 72px;
    height: 72px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-success-bg);
    border: 1.5px solid var(--color-success-border);
  }

  .success-icon {
    width: 32px;
    height: 32px;
    color: var(--color-success);
  }

  .success-title {
    font-size: 22px;
    font-weight: 800;
    color: var(--color-navy-dark);
    margin: 0 0 6px 0;
  }

  .success-subtitle {
    font-size: 14px;
    color: var(--color-text-muted);
    margin: 0 0 24px 0;
    line-height: 1.4;
  }

  .amount-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    color: #FFFFFF;
    font-weight: 800;
    font-size: 20px;
    padding: 12px 24px;
    border-radius: 16px;
    margin-bottom: 24px;
    box-shadow: 0 6px 18px rgba(2, 19, 43, 0.15);
  }

  .amount-badge-code {
    font-size: 13px;
    font-weight: 500;
    opacity: 0.85;
  }

  .tx-hash-box {
    background: #F5F6F8;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 14px;
    text-align: left;
    margin-bottom: 16px;
  }

  .tx-hash-box-label {
    font-size: 9px;
    font-weight: 800;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 0 0 6px 0;
  }

  .tx-hash-box-value {
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #2563EB;
    text-decoration: underline;
    word-break: break-all;
  }

  .spinner {
    animation: spin 1s linear infinite;
    width: 20px;
    height: 20px;
    color: #FFFFFF;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="spinner"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function SuccessScreen({ assetCode, amount, txHash }: { assetCode: string; amount: string; txHash: string }) {
  const meta = getAssetMeta(assetCode);
  return (
    <div className="min-h-screen">
      <div className="card-wrapper">
        <div className="card">
          <div className="card-header-bar" />
          <div className="card-content">
            {/* Animated checkmark */}
            <div className="success-icon-wrapper">
              <svg
                className="success-icon"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={3}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>

            <h1 className="success-title">Deposit Successful!</h1>
            <p className="success-subtitle">
              Your {assetCode} tokens have been credited to your Stellar wallet.
            </p>

            {/* Amount badge */}
            <div className="amount-badge">
              <span>{meta.symbol}</span>
              <span>{parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="amount-badge-code">{assetCode}</span>
            </div>

            {/* Tx hash */}
            <div className="tx-hash-box">
              <p className="tx-hash-box-label">Stellar TX Hash</p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-hash-box-value"
              >
                {txHash}
              </a>
            </div>

            <p className="footer-text" style={{ marginTop: '16px' }}>
              You may now close this window and return to your wallet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DepositForm({ transactionId, assetCode, stellarAccount }: DepositFormProps) {
  const meta = getAssetMeta(assetCode);

  const [amount, setAmount] = useState('');
  const [screen, setScreen] = useState<ScreenState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successData, setSuccessData] = useState<{ amount: string; txHash: string } | null>(null);
  const [, startTransition] = useTransition();

  // ── Truncate the stellar account for display ─────────────────────────────
  const shortAccount = `${stellarAccount.slice(0, 6)}…${stellarAccount.slice(-6)}`;

  // ── Amount validation ────────────────────────────────────────────────────
  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;

  // ── Submit handler ───────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValidAmount || screen === 'submitting') return;

    setScreen('submitting');
    setErrorMessage('');

    startTransition(async () => {
      try {
        const response = await fetch('/api/anchor/simulate-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: transactionId, amount: parsedAmount.toString() }),
        });

        const data = (await response.json()) as {
          success: boolean;
          stellar_tx_hash?: string;
          amount?: string;
          error?: string;
          detail?: string;
        };

        if (response.ok && data.success) {
          setSuccessData({
            amount: data.amount ?? parsedAmount.toString(),
            txHash: data.stellar_tx_hash ?? '',
          });
          setScreen('success');
        } else {
          setErrorMessage(
            data.detail
              ? `${data.error ?? 'Error'}: ${data.detail}`
              : (data.error ?? 'An unknown error occurred. Please try again.'),
          );
          setScreen('error');
        }
      } catch (networkErr: unknown) {
        setErrorMessage(
          networkErr instanceof Error
            ? `Network error: ${networkErr.message}`
            : 'Could not reach the server. Please check your connection.',
        );
        setScreen('error');
      }
    });
  }

  // ── Success screen ───────────────────────────────────────────────────────
  if (screen === 'success' && successData) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: STYLE_BLOCK }} />
        <SuccessScreen
          assetCode={assetCode}
          amount={successData.amount}
          txHash={successData.txHash}
        />
      </>
    );
  }

  // ── Main form UI ─────────────────────────────────────────────────────────
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE_BLOCK }} />
      <div className="min-h-screen">
        <div className="card-wrapper">
          {/* Card */}
          <div className="card">
            {/* Header gradient bar */}
            <div className="card-header-bar" />

            <div className="card-content">
              {/* Brand / Header */}
              <div className="header-row">
                <div className="brand-icon">
                  {meta.symbol || assetCode.slice(0, 1)}
                </div>
                <div>
                  <p className="header-text-subtitle">Deposit via GCash</p>
                  <h1 className="header-text-title">{meta.label}</h1>
                </div>
              </div>

              {/* Wallet info */}
              <div className="wallet-box">
                <p className="wallet-box-label">Crediting to wallet</p>
                <p className="wallet-box-value">{shortAccount}</p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit}>
                {/* Amount input */}
                <div className="form-group">
                  <label htmlFor="deposit-amount" className="form-label">
                    Amount ({assetCode})
                  </label>
                  <div className="input-container">
                    <span className="input-symbol">
                      {meta.symbol || assetCode}
                    </span>
                    <input
                      id="deposit-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        if (screen === 'error') setScreen('idle');
                      }}
                      disabled={screen === 'submitting'}
                      className="text-input"
                    />
                  </div>
                </div>

                {/* Error message */}
                {screen === 'error' && errorMessage && (
                  <div className="alert-box alert-danger">
                    <svg
                      style={{ height: '16px', width: '16px', marginTop: '2px', flexShrink: 0 }}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                      />
                    </svg>
                    <p style={{ margin: 0 }}>{errorMessage}</p>
                  </div>
                )}

                {/* CTA Button */}
                <button
                  id="simulate-gcash-payment-btn"
                  type="submit"
                  disabled={!isValidAmount || screen === 'submitting'}
                  className="btn-primary"
                >
                  {screen === 'submitting' ? (
                    <>
                      <Spinner />
                      <span>Processing payment…</span>
                    </>
                  ) : (
                    <>
                      {/* GCash-style icon */}
                      <svg
                        style={{ height: '20px', width: '20px' }}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                        />
                      </svg>
                      <span>Simulate GCash Payment</span>
                    </>
                  )}
                </button>
              </form>

              {/* Footer note */}
              <p className="footer-text">
                This is a Testnet simulation. No real funds will be moved.
                <br />
                Tokens will be credited to your Stellar wallet.
              </p>
            </div>
          </div>

          {/* Powered by badge */}
          <p className="powered-by">
            Powered by{' '}
            <span className="powered-by-brand">Pijin Anchor</span>
            {' '}·{' '}
            <span>SEP-24</span>
          </p>
        </div>
      </div>
    </>
  );
}
