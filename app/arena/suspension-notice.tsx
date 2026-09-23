"use client";
import { useState } from "react";
import { ShieldAlert, Send, Check } from "lucide-react";
import { MAX_APPEAL } from "@/lib/api-types";
import { request } from "./api";
import type { PlayerState } from "./arena";

/**
 * What a player sees when a case is open on their account.
 *
 * Every sanction here is decided by a program, and until now the only thing the
 * page said was "contact support" — to an address the player has to go and
 * find. A case that rests on statistics is a suspicion, and the person it is
 * about is the one witness nobody has heard: this puts their answer one box
 * away, and lands it beside the evidence in the review.
 */
export function SuspensionNotice({ player }: { player: PlayerState }) {
  const suspension = player.data.suspension;
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  if (!suspension) return null;
  const answered = sent || suspension.appealed;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/profile", { action: "appeal", text });
      setSent(true);
      void player.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="suspension" role="alert">
      <div className="suspension-head">
        <span className="suspension-icon" aria-hidden>
          <ShieldAlert size={18} />
        </span>
        <div>
          <b>{suspension.restricted ? "Your account is under review." : "Your account is suspended."}</b>
          <p>
            {suspension.reason}.{" "}
            {suspension.restricted
              ? "Practice and gems matches stay open. SOL entries, tournaments, withdrawals and tips are paused until a person has looked at it."
              : "Play, withdrawals and tips are paused while this is reviewed."}
          </p>
        </div>
      </div>

      {answered ? (
        <p className="suspension-sent">
          <Check size={14} /> Your answer is with the review team. You will be notified here when the case is decided.
        </p>
      ) : open ? (
        <div className="suspension-form">
          <label htmlFor="appeal">Tell us what happened. A person reads this next to the evidence.</label>
          <textarea
            id="appeal"
            value={text}
            maxLength={MAX_APPEAL}
            rows={3}
            placeholder="How you play, what you were doing, anything that helps: device, browser, extensions."
            onChange={(e) => setText(e.target.value)}
          />
          <div className="suspension-actions">
            <small>
              {text.length}/{MAX_APPEAL} · one message per case
            </small>
            <button className="btn btn-primary" disabled={busy || text.trim().length < 10} onClick={() => void send()}>
              <Send size={14} /> {busy ? "Sending…" : "Send my answer"}
            </button>
          </div>
          {error && <small className="suspension-error">{error}</small>}
        </div>
      ) : (
        <button className="btn" onClick={() => setOpen(true)}>
          <Send size={14} /> Appeal this
        </button>
      )}
    </div>
  );
}
