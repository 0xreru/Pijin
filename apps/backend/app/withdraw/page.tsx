'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error';

interface SubmitResponse {
  success?: boolean;
  error?: string;
}

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #f1f5f9; }
  body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .withdraw-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; color: #0f172a; }
  .withdraw-card { width: 100%; max-width: 440px; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 24px; background: #fff; box-shadow: 0 24px 60px rgba(15, 23, 42, .12); }
  .withdraw-accent { height: 7px; background: linear-gradient(90deg, #04295a, #0b67d1); }
  .withdraw-content { padding: 32px; }
  .withdraw-kicker { margin: 0 0 6px; color: #2563eb; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .withdraw-title { margin: 0; color: #04295a; font-size: 28px; line-height: 1.2; }
  .withdraw-copy { margin: 10px 0 26px; color: #64748b; font-size: 14px; line-height: 1.55; }
  .withdraw-field { display: grid; gap: 8px; margin-bottom: 18px; }
  .withdraw-label { color: #334155; font-size: 14px; font-weight: 700; }
  .withdraw-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 12px; padding: 13px 14px; background: #fff; color: #0f172a; font: inherit; outline: none; transition: border-color .15s, box-shadow .15s; }
  .withdraw-input:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37, 99, 235, .12); }
  .withdraw-input:disabled { cursor: not-allowed; background: #f8fafc; }
  .withdraw-hint { margin: -2px 0 0; color: #94a3b8; font-size: 12px; }
  .withdraw-alert { margin: 0 0 18px; border-radius: 12px; padding: 12px 14px; font-size: 13px; line-height: 1.45; }
  .withdraw-alert-error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
  .withdraw-alert-success { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; }
  .withdraw-button { width: 100%; border: 0; border-radius: 12px; padding: 14px 18px; background: #04295a; color: #fff; cursor: pointer; font: inherit; font-weight: 800; transition: transform .15s, opacity .15s; }
  .withdraw-button:hover:not(:disabled) { transform: translateY(-1px); }
  .withdraw-button:disabled { cursor: not-allowed; opacity: .55; }
  .withdraw-security { display: flex; gap: 9px; margin: 20px 0 0; color: #64748b; font-size: 12px; line-height: 1.45; }
  .withdraw-lock { flex: 0 0 auto; color: #2563eb; }
  @media (max-width: 480px) { .withdraw-content { padding: 26px 22px; } }
`;

function WithdrawalForm() {
  const searchParams = useSearchParams();
  const transactionId = searchParams.get('transaction_id') ?? '';
  const token = searchParams.get('token') ?? '';

  const [amount, setAmount] = useState('');
  const [gcashNumber, setGcashNumber] = useState('');
  const [state, setState] = useState<SubmissionState>('idle');
  const [message, setMessage] = useState('');

  const hasSession = Boolean(transactionId && token);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasSession || state === 'submitting') return;

    setState('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/anchor/submit-withdraw', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: transactionId,
          amount,
          gcash_number: gcashNumber,
        }),
      });

      const data = (await response.json()) as SubmitResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Unable to submit the withdrawal.');
      }

      setState('success');
      setMessage('Details accepted. Confirm the PHPC transfer in your wallet.');

      // SEP-24 magic handoff: close the webview and let the Wallet SDK build
      // the user-signed payment to the Treasury Cold Storage destination.
      if (typeof window !== "undefined" && window.parent) {
        window.parent.postMessage({ type: "success", status: "pending_user_transfer_start" }, "*");
      }
    } catch (error: unknown) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'A network error occurred.');
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <main className="withdraw-shell">
        <section className="withdraw-card" aria-labelledby="withdraw-title">
          <div className="withdraw-accent" />
          <div className="withdraw-content">
            <p className="withdraw-kicker">SEP-24 Withdrawal</p>
            <h1 id="withdraw-title" className="withdraw-title">Cash out to GCash</h1>
            <p className="withdraw-copy">
              Enter your payout details. Your wallet will then ask you to approve the PHPC transfer.
            </p>

            {!hasSession && (
              <div className="withdraw-alert withdraw-alert-error" role="alert">
                This withdrawal link is invalid or incomplete. Return to your wallet and start again.
              </div>
            )}

            {message && (
              <div
                className={`withdraw-alert ${state === 'success' ? 'withdraw-alert-success' : 'withdraw-alert-error'}`}
                role={state === 'error' ? 'alert' : 'status'}
              >
                {message}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="withdraw-field">
                <label className="withdraw-label" htmlFor="withdraw-amount">Amount (PHPC)</label>
                <input
                  className="withdraw-input"
                  id="withdraw-amount"
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min="0.0000001"
                  step="0.0000001"
                  placeholder="0.00"
                  autoComplete="off"
                  required
                  disabled={!hasSession || state === 'submitting' || state === 'success'}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>

              <div className="withdraw-field">
                <label className="withdraw-label" htmlFor="gcash-number">GCash Number</label>
                <input
                  className="withdraw-input"
                  id="gcash-number"
                  name="gcash_number"
                  type="tel"
                  inputMode="tel"
                  placeholder="09XXXXXXXXX"
                  autoComplete="tel"
                  pattern="(?:09[0-9]{9}|\\+639[0-9]{9})"
                  required
                  disabled={!hasSession || state === 'submitting' || state === 'success'}
                  value={gcashNumber}
                  onChange={(event) => setGcashNumber(event.target.value)}
                />
                <p className="withdraw-hint">Use the mobile number registered to your GCash account.</p>
              </div>

              <button
                className="withdraw-button"
                type="submit"
                disabled={!hasSession || state === 'submitting' || state === 'success'}
              >
                {state === 'submitting' ? 'Submitting…' : state === 'success' ? 'Submitted' : 'Continue to wallet approval'}
              </button>
            </form>

            <p className="withdraw-security">
              <span className="withdraw-lock" aria-hidden="true">▣</span>
              Withdrawn tokens are sent directly to the anchor Treasury Cold Storage vault, never the relayer hot wallet.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

export default function WithdrawalPage() {
  return (
    <Suspense fallback={<main className="withdraw-shell">Loading withdrawal…</main>}>
      <WithdrawalForm />
    </Suspense>
  );
}
