"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { RELEASES, type ChangeKind } from "@/lib/changelog";
import { markNewsSeen } from "../news";
import styles from "./whats-new.module.css";

const KIND: Record<ChangeKind, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Every update to Bounce, newest first (lib/changelog.ts). Opening it marks them read. */
export function WhatsNewView() {
  useEffect(() => markNewsSeen(), []);
  return (
    <section className={`subpage ${styles.page}`}>
      <div className="page-intro">
        <div>
          <div className="tag lime">WHAT&apos;S NEW</div>
          <h1>Every update, as it lands.</h1>
          <p>
            What changed on Bounce, newest first. Spotted something wrong, or missing? <Link href="/rules">The rules</Link> say how everything works, and the bug
            button at the bottom of every page reaches us directly.
          </p>
        </div>
      </div>
      <ol className={styles.timeline}>
        {RELEASES.map((release, i) => (
          <li key={release.date} className={styles.release}>
            <div className={styles.when}>
              <time dateTime={release.date}>{day(release.date)}</time>
              {i === 0 && <span className={styles.latest}>Latest</span>}
            </div>
            <article className={styles.card}>
              <h2>{release.title}</h2>
              <p className={styles.summary}>{release.summary}</p>
              <ul className={styles.changes}>
                {release.changes.map((change) => (
                  <li key={change.text}>
                    <span className={`${styles.kind} ${styles[change.kind]}`}>{KIND[change.kind]}</span>
                    <span>{change.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
      <p className={styles.foot}>
        <Link href="/">
          Back to the arena <ArrowUpRight size={14} />
        </Link>
      </p>
    </section>
  );
}
