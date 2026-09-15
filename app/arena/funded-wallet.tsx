"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpFromLine, Check, Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Transfer } from "@/lib/api-types";
import { request } from "./api";

type WalletData = {
  configured: boolean;
  address?: string | null;
  balance: number;
  transfers: Transfer[];
  /** Treasury only: every transfer still awaiting an on-chain outcome. */
  open?: Transfer[];
};

const OPEN_STATUSES = ["pending", "review"];
const fullSol = (lamports: number) => (lamports / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });
const explorer = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

export function FundedWallet({ treasury = false }: { treasury?: boolean }) {
  const path = treasury ? "/api/treasury" : "/api/wallet";
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stage, setStage] = useState<"edit" | "confirm">("edit");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [copied, setCopied] = useState(false);
  // Operation IDs survive failed attempts, so a retry can never create a second payment.
  const withdrawalId = useRef<string | null>(null);
  const depositId = useRef<string | null>(null);

  const load = useCallback(() => request<WalletData>(path).then(setData, (e: Error) => setError(e.message)), [path]);

  useEffect(() => {
    let active = true;
    request<WalletData>(path).then(
      (next) => active && setData(next),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [path]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<Record<string, unknown>>(path, body);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const deposit = async () => {
    depositId.current ??= crypto.randomUUID();
    if (await act({ action: "deposit", id: depositId.current })) depositId.current = null;
  };

  const withdraw = async () => {
    withdrawalId.current ??= crypto.randomUUID();
    if (await act({ action: "withdraw", id: withdrawalId.current, amount, destination })) {
      setDialogOpen(false);
      setStage("edit");
      withdrawalId.current = null;
      setAmount("");
      setDestination("");
    }
  };

  const recheckAll = async () => {
    const result = (await act({ action: "reconcile_all" })) as { checked: number; resolved: number; failed: number } | null;
    if (result) setNotice(`Checked ${result.checked} open transfer(s): ${result.resolved} resolved, ${result.failed} could not be checked.`);
  };

  return (
    <section className="panel funded-wallet" style={{ margin: "26px 0 32px" }}>
      <div className="panel-title">
        <h2>{treasury ? "Solana house treasury" : "Your Solana wallet"}</h2>
        <span className="demo-tag">DEVNET · TEST SOL</span>
      </div>
      <p className="muted">
        {treasury
          ? "Only earned house fees are available here. Player balances and reserved match pots cannot be withdrawn by this control."
          : "Fund a match using Solana’s test network. Devnet SOL has no monetary value and is separate from demo credits."}
      </p>
      {error && (
        <p className="error" role="alert" style={{ marginTop: 15 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="fine" role="status" style={{ marginTop: 15 }}>
          {notice}
        </p>
      )}
      {!data ? (
        <p className="muted" style={{ marginTop: 20 }}>
          {error ? "Sign in and create a player profile to use the wallet." : "Loading your wallet…"}
        </p>
      ) : !data.configured ? (
        <div className="callout">
          <ShieldCheck />
          <div>
            <h3>Solana funding is not connected yet.</h3>
            <p>The wallet controls will be available after the development payment service is configured. Real SOL is not accepted.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="wallet-value">
            {fullSol(data.balance)} <small>devnet SOL available</small>
          </div>
          {data.address && (
            <>
              <label className="field">
                Your deposit address · devnet only
                <input readOnly className="input" value={data.address} onFocus={(e) => e.target.select()} />
              </label>
              <div className="row-actions">
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(data.address!);
                      setCopied(true);
                    } catch {
                      setError("Select and copy the address above.");
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a className="btn" href={explorer("address", data.address)} target="_blank" rel="noreferrer">
                  View wallet <ExternalLink />
                </a>
              </div>
              <p className="fine" style={{ marginTop: 12 }}>
                Send test SOL to this address, then check the deposit. Funds become available after a confirmed transfer into the player pool.
                The network fee is deducted from the deposit.
              </p>
            </>
          )}
          <div className="wallet-actions">
            {!treasury && (
              <button className="btn btn-primary" disabled={busy} onClick={() => void deposit()}>
                <RefreshCw />
                Check deposit
              </button>
            )}
            <button
              className="btn"
              disabled={busy || data.balance <= 0}
              onClick={() => {
                setDialogOpen(true);
                setStage("edit");
              }}
            >
              <ArrowUpFromLine />
              {treasury ? "Transfer earned fees" : "Withdraw test SOL"}
            </button>
            <button className="btn" onClick={() => void load()} disabled={busy}>
              Refresh balance
            </button>
          </div>
          <p className="fine">
            Withdrawal amounts plus network fees are reserved immediately. If a transaction expires without landing, the full reserved amount returns
            when it is rechecked.
          </p>
          {data.transfers.length > 0 && (
            <div className="table-card" style={{ marginTop: 25 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transfer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Network fee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transfers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.kind}</TableCell>
                      <TableCell>{fullSol(t.amount)}</TableCell>
                      <TableCell>{fullSol(t.fee)}</TableCell>
                      <TableCell>
                        <b className={t.status === "finalized" ? "lime" : ""}>{t.status}</b>
                        {t.error && (
                          <p className="fine" style={{ maxWidth: 250, whiteSpace: "normal" }}>
                            {t.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="row-actions">
                          <a className="btn" href={explorer("tx", t.signature)} target="_blank" rel="noreferrer" aria-label="View transaction">
                            <ExternalLink />
                          </a>
                          {OPEN_STATUSES.includes(t.status) && (
                            <button className="btn" disabled={busy} onClick={() => void act({ action: "reconcile", id: t.id })}>
                              Recheck
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {treasury && !!data.open?.length && (
            <div style={{ marginTop: 20 }}>
              <h3>Open transfers</h3>
              <p className="fine">
                Any open transfer from the player pool blocks the next withdrawal until it resolves. Rechecking finalizes it, refunds it once its
                transaction has provably expired, or resubmits the same signed bytes. No replacement payment is ever created.
              </p>
              <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void recheckAll()}>
                <RefreshCw />
                Recheck all
              </button>
              {data.open.map((t) => (
                <div key={t.id} className="math-line" style={{ gap: 12, marginTop: 12 }}>
                  <span>
                    {t.kind} · {t.status} · {t.signature.slice(0, 12)}…
                  </span>
                  <button className="btn" disabled={busy} onClick={() => void act({ action: "reconcile", id: t.id })}>
                    Recheck
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!busy) setDialogOpen(v);
        }}
      >
        <DialogContent className="dialog-dark">
          <DialogTitle>{stage === "confirm" ? "Confirm your transfer" : "Withdraw devnet SOL"}</DialogTitle>
          <DialogDescription>
            {stage === "confirm"
              ? "Confirm the full destination address and amount. A blockchain transfer cannot be reversed. The network fee is added to the reserved amount."
              : "Enter an external Solana wallet on devnet. These funds are for testing only."}
          </DialogDescription>
          {stage === "edit" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                withdrawalId.current = null;
                setStage("confirm");
              }}
            >
              <label className="field">
                Destination address
                <input
                  className="input"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  required
                  minLength={32}
                  maxLength={44}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Amount · devnet SOL
                <input
                  className="input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,9})?"
                  placeholder="0.1"
                />
              </label>
              <button className="btn btn-primary full" type="submit">
                Review transfer
              </button>
            </form>
          ) : (
            <>
              <p style={{ overflowWrap: "anywhere" }}>
                To: <strong>{destination}</strong>
              </p>
              <p>
                Amount: <strong>{amount} devnet SOL</strong>
              </p>
              <p className="fine">A network fee of up to 0.001 devnet SOL will be added. Available balance must cover both the transfer and the fee.</p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row-actions">
                <button className="btn" disabled={busy} onClick={() => setStage("edit")}>
                  Back
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void withdraw()}>
                  {busy ? "Submitting…" : "Confirm transfer"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
