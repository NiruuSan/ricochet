import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";
import styles from "./legal.module.css";

export type LegalSection = { id: string; title: string; body: ReactNode };

/**
 * A legal document laid out to be read rather than skimmed past: everything
 * open, and a contents list that jumps to each part (whose address can be
 * shared to point at one clause).
 */
export function LegalPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <article className={`subpage ${styles.page}`}>
      <div className="tag lime" style={{ marginBottom: 12 }}>
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p className={styles.updated}>Last updated {LEGAL.updated}</p>
      <div className={styles.intro}>{intro}</div>
      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="Contents">
          <p>Contents</p>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className={styles.body}>
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className={styles.section}>
              <h2>
                <span className={styles.number}>{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

/** A two-column table of facts, readable on a phone as stacked rows. */
export function FactTable({ head, rows }: { head: [string, string] | [string, string, string]; rows: ReactNode[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} data-label={head[j]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
