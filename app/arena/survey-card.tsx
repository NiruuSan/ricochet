"use client";
import { useState, useSyncExternalStore } from "react";
import { MessageSquareHeart, X } from "lucide-react";
import { Form } from "@/components/ui/form";
import { ANSWER_MAX } from "@/lib/survey-limits";
import { request } from "./api";
import { toast } from "./feedback";
import styles from "./survey-card.module.css";

// The beta survey (lib/survey.ts), as a card in the corner of the arena: never
// over a board being played, gone for three days with "Not now", gone for good
// once answered.

const SNOOZE = "bounce.survey.snooze";
const SNOOZE_MS = 3 * 86_400_000;

function snoozedUntil() {
  try {
    return Number(localStorage.getItem(SNOOZE) ?? 0);
  } catch {
    return 0;
  }
}

export function SurveyCard({ survey, onDone }: { survey: { id: string }; onDone: () => void }) {
  // Read once on the client: the server renders no card, and the first client render decides.
  const snoozed = useSyncExternalStore(
    () => () => {},
    () => snoozedUntil() > Date.now(),
    () => true,
  );
  const [hidden, setHidden] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (snoozed || hidden) return null;

  const later = () => {
    try {
      localStorage.setItem(SNOOZE, String(Date.now() + SNOOZE_MS));
    } catch {
      // Without storage it simply comes back next visit.
    }
    setHidden(true);
  };
  const send = async () => {
    if (score === null) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/survey", { survey: survey.id, score, answer });
      toast("Thank you!", { detail: "Every answer is read. It shapes what comes next." });
      setHidden(true);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={styles.card} aria-labelledby="survey-title">
      <button className={styles.close} onClick={later} aria-label="Not now">
        <X size={15} />
      </button>
      <div className={styles.head}>
        <MessageSquareHeart size={18} />
        <h2 id="survey-title">Two questions, one minute</h2>
      </div>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <p className={styles.question} id="survey-score">
          How likely are you to recommend Bounce to a friend?
        </p>
        <div className={styles.scale} role="radiogroup" aria-labelledby="survey-score">
          {Array.from({ length: 11 }, (_, n) => (
            <button type="button" key={n} role="radio" aria-checked={score === n} className={score === n ? styles.picked : undefined} onClick={() => setScore(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className={styles.ends} aria-hidden>
          <span>Not at all</span>
          <span>Absolutely</span>
        </div>
        <label className={styles.question} htmlFor="survey-answer">
          What is one thing we should fix or add?
        </label>
        <textarea
          id="survey-answer"
          className={styles.answer}
          value={answer}
          maxLength={ANSWER_MAX}
          rows={3}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="A bug, a feature, something that felt unfair… (optional)"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className="btn" onClick={later} disabled={busy}>
            Not now
          </button>
          <button className="btn btn-primary" disabled={busy || score === null}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </Form>
    </aside>
  );
}
