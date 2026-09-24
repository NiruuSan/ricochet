"use client";
import { useEffect, useState } from "react";
import { Form } from "@/components/ui/form";
import { Check, Copy, Gift, HandCoins, Pencil, Share2, Users } from "lucide-react";
import { REFERRAL_FEES, type ReferralSummary } from "@/lib/api-types";
import { request } from "./api";
import styles from "./wallet.module.css";
import { currency, fullSol } from "./format";

const hoursLeft = (until: number) => Math.max(1, Math.round((until - Date.now()) / 3_600_000));

/**
 * The player's referral code, what it gives the people who use it, and what it
 * has paid back. A partnership (level 2) is granted by an administrator and
 * adds a share of the house fee on every match its players play.
 */
export function ReferralCard({ onClaimed }: { onClaimed?: () => void } = {}) {
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [copied, setCopied] = useState<"" | "code" | "link">("");
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(0);
  useEffect(() => {
    let active = true;
    request<ReferralSummary>("/api/referrals").then(
      (next) => active && setData(next),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;
  if (!data) return <p className={styles.depositNote}>Loading your referral code…</p>;
  const partner = data.level >= 2;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/signup?ref=${data.code}`;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await request<{ code: string }>("/api/referrals", { action: "code", code: draft });
      setData({ ...data, code: saved.code });
      setDraft(null);
      setCopied("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** Takes everything the partnership has earned into the spendable balance. */
  const claim = async () => {
    setClaiming(true);
    setError("");
    try {
      const { claimed: amount } = await request<{ claimed: number }>("/api/referrals", { action: "claim" });
      setClaimed(amount);
      setData({ ...data, pending: 0 });
      onClaimed?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const copy = async (text: string, what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError("Select the code and copy it by hand.");
    }
  };

  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <h2>
            <Gift size={18} />
            Refer a player
          </h2>
          <p>
            {partner
              ? "Players who sign up with your code pay a reduced house fee for a week, and every match they play pays you a share of the fee — for as long as they play."
              : "Players who sign up with your code pay 8% house fee instead of 12% for their first 24 hours. Their winnings are unchanged: the difference is credited straight back to them."}
          </p>
        </div>
        <span className={partner ? styles.partnerBadge : styles.network}>{partner ? "PARTNER" : "LEVEL 1"}</span>
      </div>

      {draft === null ? (
        <div className={styles.referralRow}>
          <button type="button" className={styles.referralCode} onClick={() => void copy(data.code, "code")} aria-label="Copy your referral code">
            <span>{data.code}</span>
            {copied === "code" ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button className="btn" onClick={() => void copy(link, "link")}>
            {copied === "link" ? <Check /> : <Share2 />}
            {copied === "link" ? "Link copied" : "Copy invite link"}
          </button>
          <button className="btn" onClick={() => (setError(""), setDraft(data.code))}>
            <Pencil /> Change code
          </button>
        </div>
      ) : (
        <Form className={styles.referralRow} onSubmit={(event) => (event.preventDefault(), void save())}>
          <input
            className="input"
            value={draft}
            onChange={(event) => setDraft(event.target.value.toLowerCase().slice(0, 20))}
            aria-label="Your referral code"
            placeholder="yourname"
            autoComplete="off"
            autoFocus
            style={{ maxWidth: 260, letterSpacing: 1 }}
          />
          <button className="btn btn-primary" disabled={saving || !draft.trim()}>
            {saving ? "Saving…" : "Save code"}
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => (setDraft(null), setError(""))}>
            Cancel
          </button>
        </Form>
      )}
      {draft !== null && <p className={styles.depositNote}>4 to 20 letters or numbers. Your current code keeps working, and nobody else can ever take it.</p>}
      {error && (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      <div className={styles.referralStats}>
        <div>
          <span>
            <Users size={15} /> Players joined
          </span>
          <strong>{data.joined.toLocaleString("en")}</strong>
        </div>
        <div>
          <span>
            <Gift size={15} /> {partner ? "Earned as a partner" : "Partner earnings"}
          </span>
          <strong>{partner ? `${fullSol(data.earned)} ${currency("devnet")}` : "—"}</strong>
        </div>
      </div>

      {partner && (
        <div className={styles.claimCard}>
          <div>
            <span>
              <HandCoins size={15} /> Ready to claim
            </span>
            <b className={styles.claimAmount}>
              {fullSol(data.pending)}
              <small>{currency("devnet")}</small>
            </b>
            <p className={styles.claimNote}>
              {claimed > 0
                ? `${fullSol(claimed)} ${currency("devnet")} is in your balance.`
                : data.pending > 0
                  ? "Your share of every match your players play, waiting for you."
                  : "Your share gathers here as your players play. Come back and take it."}
            </p>
          </div>
          <button className="btn btn-primary" disabled={claiming || data.pending <= 0} onClick={() => void claim()}>
            <HandCoins size={15} /> {claiming ? "Claiming…" : "Claim earnings"}
          </button>
        </div>
      )}

      {data.discountUntil && (
        <p className="callout-inline" role="status" style={{ marginTop: 14 }}>
          <Gift size={14} /> {data.referredBy ? `${data.referredBy} brought you in: ` : ""}your house fee is {REFERRAL_FEES.discounted}% instead of {REFERRAL_FEES.standard}% for the
          next {hoursLeft(data.discountUntil)} hours. The rebate lands in your balance after each match.
        </p>
      )}
      {!partner && (
        <p className={styles.depositNote}>
          Partnerships pay a share of the house fee on every match your players play. Playing a lot and bringing people in is how you get one.
        </p>
      )}
    </>
  );
}
