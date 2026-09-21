"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import styles from "./player-name-input.module.css";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "children"> & {
  value: string;
  onValueChange: (name: string) => void;
  scope?: "friends" | "admin";
  /** Search an already loaded roster without another request. */
  names?: string[];
};

/** Selecting a suggestion only fills the field; actions still need submission. */
export function PlayerNameInput({ value, onValueChange, scope = "friends", names, ...props }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ key: string; names: string[]; error: boolean } | null>(null);
  const query = value.trim().toLowerCase();
  const key = `${scope}:${query}`;
  const visible = open && !!query && !props.disabled;

  useEffect(() => {
    if (!visible || names !== undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/players/search?scope=${scope}&q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Search unavailable");
        const next: string[] = await response.json();
        if (!controller.signal.aborted) setResult({ key, names: next, error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ key, names: [], error: true });
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [visible, names, scope, query, key]);

  const rank = (name: string) => name.toLowerCase() === query ? 0 : name.toLowerCase().startsWith(query) ? 1 : 2;
  const suggestions = names !== undefined
    ? names.filter((name) => name.toLowerCase().includes(query)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 8)
    : result?.key === key ? result.names : [];
  const loading = names === undefined && result?.key !== key;
  const failed = names === undefined && result?.key === key && result.error;
  const selected = visible && active >= 0 && active < suggestions.length ? active : -1;

  useEffect(() => {
    if (selected >= 0) list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (name: string) => {
    onValueChange(name);
    input.current?.focus();
    setOpen(false);
    setActive(-1);
  };

  return (
    <span className={styles.root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <input {...props} ref={input} className={props.className ?? "input"} value={value}
        role="combobox" aria-autocomplete="list" aria-expanded={visible}
        aria-controls={visible ? `${id}-list` : undefined}
        aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
        autoComplete="off" spellCheck={false}
        onFocus={(event) => { setOpen(true); props.onFocus?.(event); }}
        onChange={(event) => { onValueChange(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (suggestions.length) setActive(event.key === "ArrowDown"
              ? (selected + 1) % suggestions.length
              : (selected <= 0 ? suggestions.length : selected) - 1);
          } else if (event.key === "Enter" && selected >= 0) {
            event.preventDefault();
            choose(suggestions[selected]);
          } else if (event.key === "Escape" && visible) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {visible && <span className={styles.dropdown}>
        <span ref={list} id={`${id}-list`} role="listbox" aria-label="Player suggestions" aria-busy={loading} className={styles.list}>
          {suggestions.map((name, index) => (
            <button type="button" key={name} id={`${id}-${index}`} role="option" tabIndex={-1}
              aria-selected={selected === index} className={styles.option} onClick={() => choose(name)}>
              {name}
            </button>
          ))}
        </span>
        {!suggestions.length && <span className={styles.status} role="status">
          {loading ? "Looking for players…" : failed ? "Suggestions unavailable. You can still enter a name." : "No matching players."}
        </span>}
      </span>}
    </span>
  );
}
