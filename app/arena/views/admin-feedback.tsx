"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { SurveyResults } from "@/lib/survey";
import { request } from "../api";
import { timeAgo } from "../format";
import styles from "./admin.module.css";
import own from "./admin-feedback.module.css";

const tone = (score: number) => (score >= 9 ? own.promoter : score >= 7 ? own.passive : own.detractor);

/**
 * The beta survey's answers (lib/survey.ts): the net promoter score, how the
 * 0–10 scores spread, and every comment with who wrote it, newest first.
 */
export function AdminFeedback() {
  const [data, setData] = useState<SurveyResults | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "detractors" | "promoters">("all");

  useEffect(() => {
    let active = true;
    request<SurveyResults>("/api/admin/feedback").then(
      (next) => active && setData(next),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, []);

  if (!data) return error ? <div className="error" role="alert"><span>{error}</span></div> : <p className={styles.loading}>Loading answers…</p>;
  const tallest = Math.max(1, ...data.scores);
  const comments = data.comments.filter((c) => filter === "all" || (filter === "promoters" ? c.score >= 9 : c.score <= 6));
  return (
    <>
      <section className={styles.section}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span>Net promoter score</span>
            <b className={data.nps === null ? undefined : data.nps >= 30 ? "lime" : data.nps < 0 ? own.low : undefined}>{data.nps === null ? "—" : `${data.nps > 0 ? "+" : ""}${data.nps}`}</b>
            <small>Promoters (9–10) minus detractors (0–6)</small>
          </div>
          <div className={styles.stat}>
            <span>Answers</span>
            <b>{data.responses.toLocaleString("en")}</b>
            <small>
              {data.eligible
                ? `${Math.round((data.responses / data.eligible) * 100)}% of the ${data.eligible.toLocaleString("en")} ${data.eligible === 1 ? "player" : "players"} asked so far`
                : "Nobody has played five games yet"}
            </small>
          </div>
          <div className={styles.stat}>
            <span>Average score</span>
            <b>{data.average === null ? "—" : data.average.toFixed(1)}</b>
            <small>Out of 10</small>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>How likely to recommend Bounce</h3>
            <span>0 is not at all, 10 is absolutely</span>
          </div>
          <div className={own.chart} role="img" aria-label={`Answers by score: ${data.scores.map((n, score) => `${score}: ${n}`).join(", ")}`}>
            {data.scores.map((n, score) => (
              <div key={score} className={own.column}>
                <span className={own.value}>{n || ""}</span>
                <span className={`${own.bar} ${tone(score)}`} style={{ height: `${(n / tallest) * 100}%` }} />
                <span className={own.score}>{score}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>
              What players asked for <small>· {data.comments.length}</small>
            </h2>
            <p>&ldquo;What is one thing we should fix or add?&rdquo; Newest first. Bugs that need a file are better in the bug inbox.</p>
          </div>
          <div className={own.filters} role="group" aria-label="Show comments from">
            {(["all", "detractors", "promoters"] as const).map((key) => (
              <button key={key} className="btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {key === "all" ? "Everyone" : key === "detractors" ? "0–6" : "9–10"}
              </button>
            ))}
          </div>
        </div>
        {comments.length ? (
          <ul className={own.comments}>
            {comments.map((c) => (
              <li key={`${c.name}:${c.created}`}>
                <span className={`${own.badge} ${tone(c.score)}`}>{c.score}</span>
                <div>
                  <p>{c.answer}</p>
                  <span className={own.meta}>
                    <Link href={`/players/${encodeURIComponent(c.name)}`}>{c.name}</Link> · after {c.games} games · {timeAgo(c.created)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{data.comments.length ? "No comment from this group." : "No comment yet. The first arrives after a player's fifth game."}</p>
        )}
      </section>
    </>
  );
}
