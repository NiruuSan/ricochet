"use client";
import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./overlays.module.css";

const pad = (n: number) => String(n).padStart(2, "0");
const datePart = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && `${datePart(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}` === value ? date : null;
};

/** Local time, with a themed calendar and ordinary editable text instead of a browser picker. */
export function DateTimeField({ id, label, value, onChange, required }: { id: string; label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const date = validDate(value) ?? new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const selected = validDate(value);
  useEffect(() => { input.current?.setCustomValidity(value && !validDate(value) ? "Enter a valid local date and time: YYYY-MM-DD HH:mm." : ""); }, [value]);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const setTime = (hours: string, minutes: string) => {
    const date = selected ?? new Date(month.getFullYear(), month.getMonth(), 1);
    onChange(`${datePart(date)}T${hours}:${minutes}`);
  };
  return <div className={styles.dateField}>
    <input ref={input} id={id} className="input" aria-label={label} value={value.replace("T", " ")} onChange={(event) => {
      const next = event.target.value.replace(" ", "T");
      event.currentTarget.setCustomValidity(next && !validDate(next) ? "Enter a valid local date and time: YYYY-MM-DD HH:mm." : "");
      onChange(next);
    }} required={required} placeholder="YYYY-MM-DD HH:mm" autoComplete="off" aria-describedby={`${id}-hint`} />
    <Popover.Root open={open} onOpenChange={(next) => {
      if (next) { const date = validDate(value) ?? new Date(); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }
      setOpen(next);
    }}><Popover.Trigger asChild><button type="button" className={styles.calendarTrigger} aria-label={`Choose ${label.toLowerCase()} date and time`}><CalendarDays size={18} /></button></Popover.Trigger>
      <Popover.Portal><Popover.Content className={styles.calendar} sideOffset={8} collisionPadding={12} align="start" aria-label={`${label} date and time`}>
        <div className={styles.calendarHeader}><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong aria-live="polite">{month.toLocaleDateString("en", { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div>
        <div className={styles.calendarWeek} aria-hidden="true">{["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <span key={i}>{day}</span>)}</div>
        <div className={styles.calendarDays} role="group" aria-label="Choose day">
          {Array.from({ length: month.getDay() }, (_, i) => <span key={`blank-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = new Date(month.getFullYear(), month.getMonth(), i + 1);
            return <button key={i} type="button" aria-label={date.toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} aria-pressed={!!selected && datePart(selected) === datePart(date)} onClick={() => onChange(`${datePart(date)}T${selected ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}` : "12:00"}`)}>{i + 1}</button>;
          })}
        </div>
        <div className={styles.calendarTime}><span>Local time</span><label><span className="sr-only">Hour</span><input type="number" aria-label="Hour" min={0} max={23} value={selected ? pad(selected.getHours()) : "12"} onChange={(event) => { if (event.target.value && event.target.validity.valid) setTime(pad(Number(event.target.value)), selected ? pad(selected.getMinutes()) : "00"); }} /></label><b>:</b><label><span className="sr-only">Minute</span><input type="number" aria-label="Minute" min={0} max={59} value={selected ? pad(selected.getMinutes()) : "00"} onChange={(event) => { if (event.target.value && event.target.validity.valid) setTime(selected ? pad(selected.getHours()) : "12", pad(Number(event.target.value))); }} /></label></div>
        <Popover.Close asChild><button className="btn btn-primary" type="button">Done</button></Popover.Close>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <small id={`${id}-hint`} className={styles.dateHint}>YYYY-MM-DD HH:mm · your local time</small>
  </div>;
}
