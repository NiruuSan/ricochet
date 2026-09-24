"use client";

import { useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AdminOverview, Period, VolumePoint, VolumeTotals } from "@/lib/api-types";
import styles from "./volume-chart.module.css";
import admin from "./admin.module.css";
import { exactSol } from "../format";

const PERIODS = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] as const;
const WINDOWS = { day: "Last 24 hours · hourly volume", week: "Last 7 days · daily volume", month: "Last 30 days · daily volume" };
const METRICS = [
  ["entries", "Staked in matches"],
  ["matches", "Matches created"],
  ["deposits", "Player deposits"],
  ["withdrawals", "Player withdrawals"],
  ["fees", "House fees"],
] as const;
type Metric = (typeof METRICS)[number][0];
const shortNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });

function pointLabel(point: VolumePoint) {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return `${new Date(point.start).toLocaleString("en", options)} – ${new Date(point.end).toLocaleString("en", options)}`;
}

function Chart({ points, label, format, divisor }: { points: VolumePoint[]; label: string; format: (value: number) => string; divisor: number }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const left = 75, right = 820, top = 20, bottom = 220;
  const max = Math.max(...points.map((point) => point.value), 0);
  const ceiling = max > 0 ? max * 1.15 : divisor;
  const x = (i: number) => left + (i + 0.5) * (right - left) / points.length;
  const y = (value: number) => bottom - value / ceiling * (bottom - top);
  const line = points.map((point, i) => `${i ? "L" : "M"} ${x(i)} ${y(point.value)}`).join(" ");
  const selected = active === null ? null : points[active];

  return (
    <>
      <div className={styles.detail} aria-live="polite">
        {selected ? <><span>{pointLabel(selected)}</span><b>{format(selected.value)}</b></> :
          <span>{max === 0 ? "No activity in this period." : "Hover, tap or focus a point to see its volume."}</span>}
      </div>
      <div className={styles.scroll}>
        <svg className={styles.chart} viewBox="0 0 840 270" role="group" aria-labelledby={`${id}-title`} onMouseLeave={() => setActive(null)}>
          <title id={`${id}-title`}>{label}. {points.length} intervals. Values in your local time.</title>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = ceiling * tick / 4;
            const display = value / divisor;
            return <g key={tick}>
              <line x1={left} x2={right} y1={y(value)} y2={y(value)} className={styles.grid} />
              <text x={left - 12} y={y(value) + 4} textAnchor="end" className={styles.axis}>
                {display > 0 && display < 0.01 ? display.toExponential(1) : shortNumber.format(display)}
              </text>
            </g>;
          })}
          <path d={`${line} L ${x(points.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`} fill={`url(#${id}-fill)`} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          {points.map((point, i) => (
            <g key={point.start}>
              {(i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0) && (
                <text x={x(i)} y={250} textAnchor="middle" className={styles.axis}>
                  {new Date(point.start).toLocaleString("en", point.end - point.start === 3_600_000
                    ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" })}
                </text>
              )}
              <circle cx={x(i)} cy={y(point.value)} r={active === i ? 5 : 3} fill="currentColor" />
              <rect x={left + i * (right - left) / points.length} y={top} width={(right - left) / points.length} height={bottom - top}
                className={styles.target} tabIndex={0} role="img" aria-label={`${pointLabel(point)}: ${format(point.value)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)}>
                <title>{pointLabel(point)}: {format(point.value)}</title>
              </rect>
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}

function VolumeCard({ title, data, period, sol }: { title: string; data?: Partial<Record<Metric, VolumeTotals>>; period: Period; sol?: boolean }) {
  const [metric, setMetric] = useState<Metric>("entries");
  const available = sol ? METRICS : METRICS.filter(([key]) => key !== "deposits" && key !== "withdrawals" && key !== "fees");
  const format = (value: number, key: Metric = metric) => key === "matches" ? `${value.toLocaleString("en")} matches` : sol ? `${exactSol(value)} SOL` : `${value.toLocaleString("en")} gems`;
  const selected = data?.[metric];
  const label = METRICS.find(([key]) => key === metric)![1];
  return (
    <section className={styles.card} aria-label={`${title} volume`}>
      <h3>{title}</h3>
      <div className={styles.metrics} role="group" aria-label={`${title} volume metric`}>
        {available.map(([key, name]) => (
          <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
            <span>{name}</span><b>{data?.[key] ? format(data[key][period], key) : "—"}</b>
          </button>
        ))}
      </div>
      <div className={styles.caption}><b>{label}</b><span>{WINDOWS[period]}</span></div>
      {selected ? <Chart key={`${period}-${metric}`} points={selected.series[period]} label={`${title}: ${label}`} format={format} divisor={sol && metric !== "matches" ? 1e9 : 1} /> :
        <div className={styles.loading} role="status"><RefreshCw size={16} className="spin" /> Loading volume…</div>}
    </section>
  );
}

export function AdminVolume({ overview }: { overview: AdminOverview | null }) {
  const [period, setPeriod] = useState<Period>("day");
  return (
    <section className={admin.section}>
      <div className={admin.sectionHead}>
        <h2>Volume</h2>
        <div className={styles.periods} role="group" aria-label="Volume period">
          {PERIODS.map(([key, label]) => <button type="button" key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}
        </div>
      </div>
      <VolumeCard title="Devnet SOL" data={overview?.devnet} period={period} sol />
      <VolumeCard title="Gems" data={overview?.gems} period={period} />
      <p className={admin.fine}>Rolling windows ending at the last update. Times are local. Deposits and withdrawals count once confirmed on-chain.</p>
    </section>
  );
}
