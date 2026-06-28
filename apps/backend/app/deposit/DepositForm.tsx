'use client';

/**
 * @file app/deposit/DepositForm.tsx
 *
 * SEP-24 Interactive Deposit — Client Component
 * ─────────────────────────────────────────────
 * Renders the GCash-style payment UI and orchestrates the /api/anchor/simulate-payment
 * POST call.  The parent Server Component (page.tsx) has already validated the JWT
 * and resolved the AnchorTransaction; this component only handles UX state.
 *
 * States:
 *   idle        → The input form is shown; user can enter an amount.
 *   submitting  → "Simulate GCash Payment" was clicked; spinner is shown.
 *   success     → Stellar tx settled; full-screen success card is shown.
 *   error       → API returned an error; inline message + retry option.
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
    color: 'from-blue-600 to-cyan-500',
    hex: '#3b82f6',
  },
  USDC: {
    label: 'USD Coin',
    symbol: '$',
    color: 'from-indigo-600 to-blue-500',
    hex: '#6366f1',
  },
};

function getAssetMeta(code: string) {
  return (
    ASSET_META[code.toUpperCase()] ?? {
      label: code,
      symbol: '',
      color: 'from-violet-600 to-purple-500',
      hex: '#7c3aed',
    }
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-white"
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        {/* Animated checkmark */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40 animate-[pulse_1.5s_ease-in-out_3]">
          <svg
            className="h-10 w-10 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Deposit Successful!</h1>
        <p className="text-slate-400 text-sm mb-6">
          Your {assetCode} tokens have been credited to your Stellar wallet.
        </p>

        {/* Amount badge */}
        <div className={`inline-flex items-center gap-2 bg-gradient-to-r ${meta.color} px-5 py-3 rounded-xl text-white font-bold text-lg mb-6 shadow-lg`}>
          <span>{meta.symbol}</span>
          <span>{parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="opacity-80 text-sm font-medium">{assetCode}</span>
        </div>

        {/* Tx hash */}
        <div className="bg-white/5 rounded-xl p-3 text-left border border-white/10">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Stellar TX Hash</p>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors break-all"
          >
            {txHash}
          </a>
        </div>

        <p className="text-xs text-slate-500 mt-4">
          You may now close this window and return to your wallet.
        </p>
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
      <SuccessScreen
        assetCode={assetCode}
        amount={successData.amount}
        txHash={successData.txHash}
      />
    );
  }

  // ── Main form UI ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* Background decorative blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div
          className={`absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl opacity-20 bg-gradient-to-br ${meta.color}`}
        />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-10 bg-gradient-to-tr from-purple-600 to-pink-500" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Header gradient bar */}
          <div className={`h-1.5 w-full bg-gradient-to-r ${meta.color}`} />

          <div className="p-7">
            {/* Brand / Header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white font-bold text-base shadow-lg`}
              >
                {meta.symbol || assetCode.slice(0, 1)}
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest">Deposit via GCash</p>
                <h1 className="text-lg font-bold text-white leading-tight">{meta.label}</h1>
              </div>
            </div>

            {/* Wallet info */}
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-slate-500 mb-0.5">Crediting to wallet</p>
              <p className="text-sm font-mono text-slate-300">{shortAccount}</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Amount input */}
              <div>
                <label
                  htmlFor="deposit-amount"
                  className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2"
                >
                  Amount ({assetCode})
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm select-none">
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3.5 text-white text-lg font-semibold placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ '--tw-ring-color': meta.hex } as React.CSSProperties}
                  />
                </div>
              </div>

              {/* Error message */}
              {screen === 'error' && errorMessage && (
                <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <svg
                    className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0"
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
                  <p className="text-xs text-red-300 leading-relaxed">{errorMessage}</p>
                </div>
              )}

              {/* CTA Button */}
              <button
                id="simulate-gcash-payment-btn"
                type="submit"
                disabled={!isValidAmount || screen === 'submitting'}
                className={`
                  w-full flex items-center justify-center gap-2.5
                  rounded-xl px-6 py-4 font-bold text-sm text-white
                  bg-gradient-to-r ${meta.color}
                  shadow-lg shadow-blue-500/20
                  transition-all duration-200
                  hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                `}
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
                      className="h-5 w-5"
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
            <p className="text-center text-xs text-slate-600 mt-5 leading-relaxed">
              This is a Testnet simulation. No real funds will be moved.
              <br />
              Tokens will be credited to your Stellar wallet.
            </p>
          </div>
        </div>

        {/* Powered by badge */}
        <p className="text-center text-xs text-slate-700 mt-4">
          Powered by{' '}
          <span className="text-slate-500 font-semibold">Pijin Anchor</span>
          {' '}·{' '}
          <span className="text-slate-600">SEP-24</span>
        </p>
      </div>
    </div>
  );
}
