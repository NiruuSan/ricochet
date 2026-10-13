"use client";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { request } from "./api";
import { declined, signFunding, useSolanaWallets, walletAccount, type SolanaWallet } from "./solana-wallet";
import { toast } from "./feedback";
import styles from "./wallet.module.css";

const AMOUNTS = ["0.1", "0.5", "1"];

/**
 * Paying in from a wallet in this browser, in one confirmation: the amount
 * here, then the wallet's own approval. The SOL lands on the player's deposit
 * address and is credited like any other deposit, so nothing about crediting
 * changes. Without a wallet here, the address above is the way in.
 */
export function WalletDeposit({ onSent }: { onSent: () => void }) {
  const wallets = useSolanaWallets();
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!wallets.length) return null;

  const deposit = async (wallet: SolanaWallet) => {
    setBusy(wallet.name);
    setError("");
    try {
      const account = await walletAccount(wallet);
      const { transaction, chain } = await request<{ transaction: string; chain: string }>("/api/wallet", { action: "fundingTransaction", from: account.address, amount });
      const signed = await signFunding(wallet, account, transaction, chain);
      if (signed) await request("/api/wallet", { action: "fundingSend", transaction: signed });
      toast(`${amount} SOL on its way`, { detail: "It is credited as soon as the network confirms it, usually within a minute." });
      onSent();
    } catch (e) {
      if (!declined(e)) setError((e as Error).message || "Your wallet could not send this deposit.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.walletDeposit}>
      <div className={styles.walletDepositHead}>
        <Wallet size={16} />
        <b>Deposit from your wallet</b>
        <span>One approval, no address to copy</span>
      </div>
      <div className={styles.walletAmounts} role="group" aria-label="Deposit amount">
        {AMOUNTS.map((a) => (
          <button key={a} type="button" aria-pressed={amount === a} onClick={() => setAmount(a)}>
            {a} SOL
          </button>
        ))}
        <input
          className={styles.walletAmountInput}
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          inputMode="decimal"
          aria-label="Amount in SOL"
          pattern="[0-9]+(\.[0-9]{1,9})?"
        />
      </div>
      <div className={styles.walletDepositActions}>
        {wallets.map((wallet) => (
          <button key={wallet.name} type="button" className="btn btn-primary" disabled={!!busy || !/^\d+(\.\d{1,9})?$/.test(amount)} onClick={() => void deposit(wallet)}>
            <img src={wallet.icon} alt="" width={18} height={18} />
            {busy === wallet.name ? "Approve in your wallet…" : `Deposit with ${wallet.name}`}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Fills a withdrawal address from a wallet in this browser, so it is never mistyped. */
export function FillFromWallet({ onAddress }: { onAddress: (address: string) => void }) {
  const wallets = useSolanaWallets();
  const [failed, setFailed] = useState("");
  if (!wallets.length) return null;
  return (
    <div className={styles.fillFromWallet}>
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          className="btn"
          onClick={async () => {
            setFailed("");
            try {
              onAddress((await walletAccount(wallet)).address);
            } catch (e) {
              if (!declined(e)) setFailed((e as Error).message);
            }
          }}
        >
          <img src={wallet.icon} alt="" width={16} height={16} /> Use my {wallet.name} address
        </button>
      ))}
      {failed && <p className="error">{failed}</p>}
    </div>
  );
}
