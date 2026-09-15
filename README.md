# Ricochet

Playable private prototype of the requested asynchronous 1v1 brick-breaker. This development version supports free demo credits and separately accounted Solana devnet payments. **Mainnet is disabled in code; this is not a real-money launch.** Amounts use integer lamports (1 SOL = 1,000,000,000 units). The site remains private for owner testing; development payment configuration is separate from publication.

## Implemented

- Landing page, arena, saved matches, settled P&L leaderboard, player profile/login, demo wallet/activity, rules/Q&A, restricted treasury summary.
- ChatGPT platform identity with server-side authorization. Player profile creation grants 20 demo SOL once. Public email/password login is not implemented.
- Deterministic 472×612, 7×9 board; per-round seeded brick generation, sequential multi-ball flight, per-hit scores, descending rows, extra balls and clear-board bonus.
- Persistent D1 asynchronous matchmaking at the five requested entry levels. Both players can play concurrently. Saved shots support resuming across sessions. Opponent scores hidden until settlement.
- Each shot is simulated server-side; the client never submits an authoritative score. Optimistic revisions reject duplicate or stale shots.
- Atomic match entry and ledger balance updates, database-enforced nonnegative balances and one active run per player, idempotent settlement.
- Separate demo/devnet match queues, balances, match history and P&L rankings. Funded entries move into a match escrow account; settlement transfers the pot to the winner and the house. Demo credits cannot become devnet credit.
- Per-player Solana deposit addresses, encrypted server-side with AES-GCM and owner/network-bound authenticated data. Wallet provisioning occurs on signup when configured, with retry on wallet access.
- Devnet deposit sweeps into pooled custody, credited only after finalized success. Withdrawals reserve principal and network fee atomically with a durable, signed transaction outbox. Duplicate operation IDs cannot create a second payment; retries use the same signed bytes.
- Treasury balance and transfer controls at `/admin`, authorized only by `RICOCHET_ADMIN_USER_ID`. This control can withdraw earned house fees only. It cannot spend player ledger balances or reserved match pots. Administrators can recheck uncertain transactions.
- Finalized on-chain failures refund withdrawal principal once, retaining the network fee. Uncertain expired transactions remain reserved for review; no timeout is treated as proof of non-payment.

## Rules decisions

Ground is the bottom row, followed by 1–7, then sky. Bricks spawn at row 7 and have HP equal to the new round. A row-1 brick ends the run on descent. All balls must return to finish a round; the first return sets the next launch position. Each round adds one ball, and a full clear adds four more. Aim angles range from 8° to 172° to prevent horizontal non-returning shots. A fixed 120 Hz simulation is shared by server and client.

The winner receives 1.76× their own stake. The house receives 0.24× one stake, equal to 12% of both entries. Ties refund both entries fully with no fee. One forfeit loses to a completed opponent; if both forfeit, scores decide. Open matches do not expire and reserved entries are not withdrawable in this demo. Decide production expiry/refund rules before accepting funds.

## Development payment setup

Payments default to disabled, and no RPC credential or wallet encryption key is included. Configure these server-only runtime values for a private devnet test:

- `SOLANA_NETWORK=devnet`
- `SOLANA_RPC_URL`: an HTTPS endpoint for Solana devnet. The service verifies the returned genesis hash before signing/submitting financial transactions. Use a trusted RPC provider.
- `SOLANA_VAULT_KEY`: a securely generated, base64-encoded 32-byte encryption key. Back it up securely before provisioning wallets; replacing or losing it makes existing encrypted wallet keys unreadable. Key rotation is not implemented.
- `RICOCHET_ADMIN_USER_ID`: the intended administrator’s authenticated platform user ID.

Apply both committed D1 migrations through the normal deployment process. Never edit a migration after it has been applied. The second migration adds cash accounting, encrypted wallets, the payment outbox and a guard that aborts overdrafts even during idempotent settlement. There is no runtime schema creation.

Send **devnet test SOL only** to the displayed deposit address, then select Check deposit. Recheck a pending transfer to submit the same signed transaction or retrieve its finalized status. The deposit sweep fee is deducted before crediting the player. Withdrawals show the complete destination for confirmation, then calculate a network fee capped at 0.001 devnet SOL. Program addresses and internal Ricochet addresses are rejected as withdrawal destinations.

This release uses one player custody pool, with at most one pending/review outgoing transaction per source address. This intentionally serializes pool withdrawals. Transfers are driven by explicit wallet/admin actions; a background deposit watcher, scheduled reconciliation and throughput scaling are not implemented. An expired transaction whose final outcome cannot be proved remains locked, even if it may never have landed. It needs an operational investigation and a separately reviewed resolution process; never delete its record, reuse its operation ID or refund it merely because a timer elapsed.

`SOLANA_NETWORK=mainnet` does not enable anything. The real-money launch gate is independent of client input and environment flags. The country restriction list is intentionally unset pending the owner’s launch policy; this build does not claim to geoblock countries or validate a licence.

## Production work still required

This is not a production real-money service. Production still needs the operator’s completed launch review and licence, server-side location enforcement using the final country policy, public account identity and recovery, eligibility checks, independently reviewed custody and key management, background payment monitoring/reconciliation, rate limits and withdrawal abuse controls, audited operational access, anti-automation and seed/shot-exploration abuse controls, an abandoned-match policy, and security/load testing. These are outstanding work, not features enabled by changing an environment flag.

Server validation blocks direct score forgery but does not stop a client from trying angles locally against a known seed. A paid competition needs a considered competition-integrity policy and stronger controls. Practice sessions are transient. Match history and activity currently show the last 50 records. The hosted preview is private to its owner unless its access policy is explicitly changed; a second account cannot join under owner-only access.

## Development

Preserve the bundled Vinext/Cloudflare Sites build integration. `pnpm build` emits a Worker. D1 schema lives in `db/schema.ts`; migrations are in `drizzle/`. The initial migration includes the ledger balance trigger; preserve it in future migrations. Runtime schema creation is deliberately absent. Use platform auth headers only behind the trusted Sites dispatcher, not on an unprotected standalone server.

`node --experimental-strip-types tests/engine.test.ts` verifies deterministic mechanics and solid brick seams. `python tests/accounting_test.py` verifies demo ledger constraints and idempotence against SQLite. `node --experimental-strip-types tests/payments.test.mjs` (Node 24) exercises the real payment and settlement implementations against SQLite with a fully mocked RPC: exact decimal amounts, cluster rejection, encryption/tampering, finalized-only credit, duplicate operations, concurrent withdrawal reservations, identical-wire retries, expired confirmation holds, failure refunds, secret redaction, escrow conservation, tie refunds, atomic rollback, and treasury/demo isolation. The test overrides all outbound fetches; it never transfers assets on any network.

Type checking and the production Worker build are also checked. Live Solana devnet integration, real transfers, production migration application, browser-based QA and two-account testing have **not** been performed for this payment update. The main client supports mouse, touch, keyboard aim and launch, and reduced motion preferences.
