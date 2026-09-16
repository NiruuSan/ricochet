# Bounce — handoff for the next developer

This file briefs whoever continues the work (human or AI). Read it fully before changing code.

## Continuation completed — 2026-09-16

The required admin-side recovery task in §7 is implemented and included with the original TOTP work in this change. The optional player request queue was not added.

- Admin → Security: exact public-name lookup, 2FA status, recent resets, and reset form requiring recent provider sign-in, the administrator's own second factor, and a 10–300 character reason.
- `lib/security-admin.ts` batches authenticator/recovery deletion, the 72-hour hold, audit and notification. `lib/security-holds.ts` owns the duration and hold checks.
- Migration `0011_two_factor_recovery_admin.sql` adds both tables and a withdrawal insert trigger that prevents races between a reset and withdrawal reservation. Existing transfers remain reconcilable; treasury withdrawals are exempt.
- The wallet shows the hold independently of 2FA enrolment. Notifications include the deadline. The notification panel now stays within mobile viewports.
- `tests/security-admin.test.mjs` exercises the real routes with mocked authentication and a migrated test database, including rollback, privacy, lockout, hold expiry, re-enrolment and the SQL guard.
- Validation: 20 PASS groups, TypeScript clean, lint with only the two pre-existing warnings. Local browser checks passed with an isolated database, dummy HTTPS RPC URL and ephemeral secrets: admin search/reset/audit, player hold/notification, desktop/mobile layouts and no browser runtime errors. Screenshots are under ignored `outputs/security-admin/`.
- The workspace's `local.db` is migrated through `0011`. Apply migrations before running this against other existing databases. The user authorized committing and pushing this work on 2026-09-16; Vercel applies production migrations during deployment.

The sections below retain the original task brief for reference; §7 is no longer pending.

## 1. What Bounce is

An async 1v1 brick-breaker. Players aim, balls bounce, bricks break. Modes:

- **Practice**: local only, nothing at stake.
- **1v1 matches**: gems (free currency) or devnet SOL (test money). Both players play the same board separately; the higher score wins the pot. The house keeps 12% on SOL matches.
- **Tournaments**: created by the admin; one run each on the same board, prize split by rank.
- Spectator mode, profiles with stats, leaderboard, notifications, tips between players.

- Repo: `NiruuSan/ricochet` (branch `main`). Live: https://ricochet-lac.vercel.app
- Vercel deploys every push to `main`. The Vercel build runs database migrations first (`scripts/vercel-build.mjs`).
- Mainnet is disabled in code (`lib/payments/policy.ts`). Only Solana **devnet** is supported.

## 2. Stack

- Next.js 16.3.4 (App Router), React 19, TypeScript. Production builds use webpack (`next build --webpack`).
- Database: Turso / libSQL (SQLite). A small prepared-statement adapter is in `db/raw.ts` (`prepare().bind().first/all/run`, and `batch()` = one atomic write transaction).
- Schema: `db/schema.ts` (Drizzle, only for schema and migration generation). Migrations are SQL files in `drizzle/`, applied by `db/migrate.mjs`.
- Auth: Auth.js v5 (`auth.ts`), JWT sessions (7 days), GitHub always on, plus Google and Discord when configured. Player IDs look like `github:12345`. Accounts are never merged by email.
- Solana: `@solana/web3.js`, custodial wallets. Private keys are encrypted with AES-GCM under `SOLANA_VAULT_KEY` (`lib/payments/vault.ts`).
- Package manager: pnpm via corepack. Always run `corepack pnpm …`.

## 3. Commands

```bash
corepack pnpm install
corepack pnpm dev                      # local dev (uses .env.local, local.db)
corepack pnpm test                     # all test suites (19 "PASS:" lines expected)
corepack pnpm lint                     # 2 known warnings (window.location in auth-view/play-view), 0 errors
corepack pnpm exec tsc --noEmit -p .
corepack pnpm db:generate --name xyz   # after editing db/schema.ts → new drizzle/00NN_xyz.sql
TURSO_DATABASE_URL=file:local.db node scripts/migrate.mjs   # apply migrations to the local DB
```

Tests are plain Node scripts in `tests/*.test.mjs`, run with `node --experimental-strip-types`. They use a real libSQL database built from the migrations (`tests/helpers/test-env.mjs`, which also resolves `@/` imports). A new suite must be added to the `test` script in `package.json`.

- Node's strip-types mode does **not** support TypeScript parameter properties (`constructor(readonly x)`). Declare fields explicitly.
- `pnpm-workspace.yaml` enforces a supply-chain policy: only package versions published at least 7 days ago can be installed.

## 4. Rules you must follow

1. **Never ask the user to paste secrets** (Turso token, AUTH_SECRET, vault key, OAuth secrets) into a chat. Secrets go only in their terminal or in Vercel settings.
2. **Do not commit or push unless the user explicitly says so.** They usually review locally first. Commit messages end with a `Co-Authored-By:` line for the AI that wrote them.
3. **Money code must stay atomic.** Every balance change is a ledger row inserted in a `db.batch()`. A database trigger rejects negative balances. Operations are idempotent through client-generated operation IDs.
4. **Never return player IDs** (`github:…`) or secrets in API responses. Tests assert this with JSON-string checks.
5. **Game rules are versioned.** Each match or tournament stores its `ruleset`; never change the behaviour of an existing ruleset (frozen replay digests in `tests/engine.test.ts`). The current one is ruleset 6: new rows come from a per-match secret `row_key` that must never reach the browser (`lib/secret-rows.ts`).
6. **Mutating API routes** must:
   - check `sameOrigin(req)`, `currentUser()`/`administrator()` and `rateLimited(...)`;
   - parse bodies with `readBody(req, maxBytes)`, which accepts JSON only and caps the size.
   See `app/api/wallet/route.ts` for the pattern.
7. UI copy is in English; the user talks in French.

## 5. Current state

**Last pushed commit:** `01499e1`, which contains:
- performance work;
- security hardening: headers/CSP, step-up sign-in, rate limits, patched dependencies;
- ruleset 6 with hidden rows;
- profile stats.

**Not committed yet: withdrawal two-factor authentication (TOTP).** It is finished and tested, with 19 test suites passing. Files:

- `lib/two-factor.ts`: TOTP (RFC 6238), setup/confirm/verify/disable, recovery codes, lockout. See §6.
- `app/api/security/route.ts`: GET status; POST `setup` | `confirm` | `regenerate` | `disable` (all require a recent provider sign-in).
- `app/arena/two-factor-panel.tsx`: UI panel shown in the wallet (`app/arena/funded-wallet.tsx`), plus the code field in the withdrawal dialog.
- `app/api/wallet/route.ts` and `app/api/treasury/route.ts`: withdrawals call `precheckWithdrawal` and then `verifySecondFactor(user, b.code)`.
- `lib/payments/service.ts`: new `precheckWithdrawal`, `transferStarted`.
- `db/schema.ts` and `drizzle/0010_two_factor.sql`: tables `two_factor` and `two_factor_recovery`.
- `tests/two-factor.test.mjs`, plus additions to `tests/payments.test.mjs`.
- `package.json`: new dependency `qrcode-generator` and the test script entry.

Ask the user whether to commit this before or together with the next task.

## 6. How two-factor authentication works today

Table `two_factor`, one row per user:

| column | meaning |
|---|---|
| `user_id` | primary key |
| `secret` | AES-256-GCM ciphertext (JSON `{v, iv, data, tag}`); key derived by HKDF from `SOLANA_VAULT_KEY`; AAD `two-factor:<uid>` |
| `enabled` | 0 = setup pending (QR shown, not confirmed), 1 = active |
| `last_step` | highest TOTP time step accepted (replay protection) |
| `failures`, `locked_until` | 5 wrong codes → locked 15 minutes |
| `created`, `enabled_at` | timestamps (ms) |

Table `two_factor_recovery` has `code_hash` (HMAC-SHA256, keyed from the vault key), `user_id` and `used_at`. It holds 10 codes per user, format `XXXXX-XXXXX`.

Key functions in `lib/two-factor.ts`:

- `twoFactorStatus(uid)` → `{ enabled, recoveryCodesLeft, lockedUntil }`
- `beginTwoFactorSetup(uid, name)`, `confirmTwoFactorSetup(uid, code)`
- `verifySecondFactor(uid, code)` → `"totp"` or `"recovery"`, or throws `TwoFactorError` with code `TWO_FACTOR_REQUIRED | TWO_FACTOR_INVALID | TWO_FACTOR_LOCKED | TWO_FACTOR_STATE`
- `disableTwoFactor(uid, code)`, `regenerateRecoveryCodes(uid, code)`

Step-up authentication: `lib/step-up.ts` `stepUpRequired(user)` returns a `REAUTH_REQUIRED` error body unless the user signed in with their OAuth provider within 15 minutes (`authTime` claim set in `auth.ts`). The client shows a "Confirm it is you" button calling `signInWith(provider, returnPath)` from `app/auth-actions.ts`.

**The gap:** a player who loses both their phone and their recovery codes can never withdraw again, and there is no way to help them.

## 7. Next task: admin-side 2FA recovery procedure

### Goal

Let the administrator reset a player's two-factor authentication after verifying their identity outside the app. The reset must be safe even if the admin session or a player account is compromised.

### Required behaviour

1. **Admin UI.** Add a "Security" or "Players" tab to the admin page (`app/arena/views/admin-view.tsx`; tabs already exist for Overview and Tournaments).
   - Search a player by public name.
   - Show 2FA status: enabled, enabled since, recovery codes left, locked until.
   - Show recent recovery requests or resets.
   - Never show secrets, hashes or player IDs.
2. **Reset action** (`POST /api/admin/security`, admin only):
   - The admin must pass step-up (`stepUpRequired`).
   - The admin must enter **their own** valid 2FA code (`verifySecondFactor(adminUid, code)`). Require the admin to have 2FA enabled.
   - The admin must type a reason (free text, 10–300 characters, stored).
   - The reset deletes the player's `two_factor` row and their `two_factor_recovery` rows in one `db.batch()`, together with an audit log insert.
3. **Cooling-off period on withdrawals (important).** After an admin reset, the player must not be able to withdraw for a delay: **72 hours** is suggested, make it a constant. The delay starts from the reset, and it still applies once the player turns 2FA on again. Without it, a thief who tricks support into a reset could set up their own authenticator and withdraw immediately.
   - Suggested storage: table `security_holds(user_id PK, reason, until, created_by, created)`, or a column on `players`.
   - Enforce it in `precheckWithdrawal` (or in the wallet route before `verifySecondFactor`), with a clear error such as "Withdrawals are paused until <date> after a security reset."
   - Show the hold in the player's wallet (`TwoFactorPanel`, or the wallet data).
4. **Notify the player.**
   - Insert a notification (`notificationInsert` in `lib/notifications.ts`; add a new kind such as `security_reset`), so the real owner learns about it at their next visit.
   - Render it in `app/arena/notifications.tsx` (`describe()`), including the hold end date.
5. **Audit log.**
   - New table `admin_audit(id PK, admin_id, action, target_user_id, reason, created)`.
   - Insert a row for every reset, in the same batch as the reset.
   - Show the recent entries in the admin tab.
   - Do not expose `github:` IDs in responses: show player names.
6. **Rate limit** the admin endpoint (reuse the `securityWrite` or `treasuryWrite` scope in `lib/rate-limit.ts`).
7. **Optional: player-side request.** A player who is locked out can file a "Can't access my authenticator" request from the wallet. It is stored in a table (user, created, status) and appears in the admin tab, so the admin knows who is asking. The admin still verifies identity outside the app, for example by contacting them through the OAuth account's email or Discord.

### Suggested implementation steps

1. `db/schema.ts`: add `security_holds` and `admin_audit`, then run `corepack pnpm db:generate --name two_factor_recovery_admin`.
2. `lib/two-factor.ts` or a new `lib/security-admin.ts`:
   - `adminTwoFactorLookup(name)`
   - `adminResetTwoFactor(adminUid, playerName, reason, adminCode, now)`, which verifies the admin code, then batches: delete 2FA rows, upsert the hold, insert the audit row, insert the notification
   - `withdrawalHold(uid, now)`
3. `lib/payments/service.ts` `precheckWithdrawal`: throw `PaymentError` if a hold is active. The treasury is not affected, since holds are per player.
4. `app/api/admin/security/route.ts`: GET `?name=` lookup plus recent audit entries; POST `reset`. Follow the admin tournaments route pattern (`app/api/admin/tournaments/route.ts`) and use `administrator()`.
5. UI:
   - admin tab component, modelled on `app/arena/views/admin-tournaments.tsx`;
   - hold notice in `two-factor-panel.tsx` / `funded-wallet.tsx`;
   - notification rendering.
6. Tests: a new `tests/security-admin.test.mjs` (add it to `package.json`), covering at least:
   - non-admin rejected;
   - admin without 2FA rejected;
   - wrong admin code rejected, and counted towards the admin's lockout;
   - reset removes the player's 2FA and recovery codes;
   - the hold blocks `precheckWithdrawal` until the deadline, then allows it;
   - the hold survives the player re-enabling 2FA;
   - audit row and notification created;
   - responses never include player IDs, secrets or hashes.
7. Run `corepack pnpm test`, `lint` and `tsc`. Check in the browser with a local server: `SOLANA_NETWORK=devnet`, a dummy `SOLANA_RPC_URL`, and a random 32-byte base64 `SOLANA_VAULT_KEY` passed as environment variables, never written to committed files. Do not commit unless asked.

### Useful references in the code

- Admin identity: `administrator()` in `lib/auth-user.ts` (compares with `RICOCHET_ADMIN_USER_ID`).
- Notifications: `lib/notifications.ts`; client rendering in `app/arena/notifications.tsx`; types `NotificationItem` in `lib/api-types.ts`.
- Error-to-response mapping for 2FA: `TwoFactorError` handling in `app/api/wallet/route.ts`.
- Example of a test with a real DB and a mocked network: `tests/two-factor.test.mjs`.
