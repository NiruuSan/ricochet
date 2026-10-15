"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STARTING_GEMS, winnerPayout, type ChallengePreview } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { RankBadge } from "../rank-badge";
import { amount } from "../format";
import { rememberNext } from "../referral-link";
import styles from "./challenge-invite.module.css";

/**
 * A challenge link opened by someone without a player yet. Instead of an error
 * at the door, it says who is waiting and for how much, and the way in brings
 * them back to this very seat once they have signed up.
 */
export function ChallengeInvite({ code, authenticated, onClose }: { code: string; authenticated: boolean; onClose: () => void }) {
  const [challenge, setChallenge] = useState<ChallengePreview | null>(null);
  const [error, setError] = useState("");
  const seat = `/?join=${encodeURIComponent(code)}`;

  useEffect(() => {
    let active = true;
    request<ChallengePreview>(`/api/challenges/${encodeURIComponent(code)}`).then(
      (found) => active && setChallenge(found),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [code]);

  const enter = `${authenticated ? "/signup" : "/login"}?next=${encodeURIComponent(seat)}`;
  const open = !!challenge?.open;
  // Signing up later, from anywhere, still comes back to an open seat.
  useEffect(() => {
    if (open) rememberNext(seat);
  }, [open, seat]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={`dialog-dark ${styles.card}`}>
        {!challenge ? (
          <>
            <DialogTitle>{error ? "This challenge is closed" : "Opening the challenge…"}</DialogTitle>
            <DialogDescription>{error || "Checking who sent it."}</DialogDescription>
            {error && (
              <button className="btn btn-primary full" style={{ marginTop: 16 }} onClick={onClose}>
                Play free practice <ArrowRight />
              </button>
            )}
          </>
        ) : (
          <>
            <div className={styles.from}>
              <Avatar name={challenge.from} src={challenge.avatar} size={64} />
              <span className={styles.badge}>
                <Swords size={14} />
              </span>
            </div>
            <DialogTitle className={styles.title}>{challenge.from} challenged you</DialogTitle>
            <div className={styles.rank}>
              <RankBadge rank={challenge.ranked} />
            </div>
            <DialogDescription className={styles.copy}>
              {open
                ? "Same board, one run each. Beat their score and the pot is yours."
                : "Someone already took this seat. Practice is free while you wait for the next one."}
            </DialogDescription>
            {open && (
              <div className={styles.stakes}>
                <div>
                  <span>Entry</span>
                  <b>{challenge.stake ? amount(challenge.stake, challenge.asset) : "Free"}</b>
                </div>
                <div>
                  <span>Winner receives</span>
                  <b className="lime">{challenge.stake ? amount(winnerPayout(challenge.stake, challenge.asset), challenge.asset) : "Bragging rights"}</b>
                </div>
              </div>
            )}
            {open ? (
              <>
                <Link className="btn btn-primary full" href={enter}>
                  {authenticated ? "Pick your name and accept" : "Sign in to accept"} <ArrowRight />
                </Link>
                <p className={styles.fine}>
                  {challenge.asset === "gems" ? `New players start with ${STARTING_GEMS.toLocaleString("en")} free gems. ` : ""}
                  You come straight back to this seat.
                </p>
              </>
            ) : null}
            <button className={`btn full ${styles.later}`} onClick={onClose}>
              {open ? "Practice first" : "Play free practice"}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
