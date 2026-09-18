"use client";
import { ChevronDown } from "lucide-react";
import styles from "./show-more.module.css";

export const ENTRY_BATCH = 5;

export function ShowMore({ shown, total, onShowMore, label }: { shown: number; total: number; onShowMore: () => void; label: string }) {
  if (!total) return null;
  return <div className={styles.footer}>
    <span role="status">Showing {shown} of {total} {label}</span>
    {shown < total && <button type="button" className="btn" onClick={onShowMore} aria-label={`Show more ${label}`}>Show more <ChevronDown size={15} /></button>}
  </div>;
}
