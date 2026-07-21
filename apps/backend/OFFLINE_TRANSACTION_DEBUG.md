# Offline transaction backend debug trace

Set this environment variable on the backend and restart/redeploy it:

```env
OFFLINE_TRANSACTION_DEBUG=true
```

Every accepted webhook response now includes a `traceId`. The same value is
forwarded in the QStash job, so the entire flow can be found by searching the
backend logs for that ID.

## Trace order

1. `receive:http` — method, redacted URL, and redacted HTTP headers
2. `receive:raw-body` — exact Textbee JSON request body
3. `receive:auth` — HMAC or URL-secret authentication result (never the secret)
4. `receive:extracted-sms` — sender, event type, and exact compressed SMS body
5. `decompress-1:parts` — all six payload parts and their character lengths
6. `decompress-1:amount` — Base62 amount before and stroop value after decoding
7. `decompress-2:base64` — Base64 padding restoration plus decoded nonce/signature bytes
8. `queue:published` — deduplication ID, QStash result, and worker target
9. `settle:received` — exact QStash HTTP request received by the worker
10. `db:pending-created` / `db:pending-resumed` — database idempotency state
11. `db:hydrated` — resolved sender, receiver, and token records used for settlement
12. `verify:xdr-reconstructed` — exact tuple fields and reconstructed signature XDR
13. `verify:ed25519` — enrolled public key, signature, and local verification result
14. `soroban:contract-payload` — exact `spend_offline` method arguments
15. `soroban:assembled` — simulated/assembled transaction JSON and unsigned XDR
16. `soroban:signing-input` / `soroban:signed` — unsigned and relayer-signed transaction XDR
17. `soroban:submitted` — RPC submission response and transaction hash
18. `db:settled` or `db:failed` — final database state

All entries begin with `[OfflineVoucher:backend:` and are formatted as JSON.
BigInt and byte values are converted to inspectable decimal, Base64, and hex
strings.

## Safety

This mode contains phone numbers, the complete voucher, signatures, and full
transaction XDR, so use it only for controlled demonstrations and turn it off
afterward. URL secrets, HMAC/QStash signatures, cookies, API keys, authorization
headers, and the relayer secret key are always redacted or excluded.
