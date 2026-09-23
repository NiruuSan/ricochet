"use client";
import type { CSSProperties } from "react";
import { themeById, type FontKey, type Theme } from "@/lib/themes";

// How a theme reaches the screens around the board.
//
// The board is painted from the theme object itself (app/arena/board-canvas.ts).
// Everything else — the frame, the score, the end-of-run screen — is CSS, so
// the theme arrives as a handful of custom properties set on the containers the
// theme is allowed to touch. Nothing outside those containers reads them, which
// is why a skin can never make the wallet or the admin unreadable.

/** The typefaces loaded in app/layout.tsx, by the key a theme names. */
const FONTS: Record<FontKey, string> = {
  system: "Arial, Helvetica, sans-serif",
  orbitron: "var(--font-orbitron), Arial, sans-serif",
  pixel: "var(--font-pixel), ui-monospace, monospace",
  serif: "var(--font-serif), Georgia, serif",
  mono: "var(--font-mono), ui-monospace, monospace",
  round: "var(--font-round), Arial, sans-serif",
};

/** The custom properties a themed container carries. */
export function themeStyle(skin: Theme | string | null | undefined): CSSProperties {
  const theme = typeof skin === "object" && skin ? skin : themeById(typeof skin === "string" ? skin : null);
  return {
    "--t-accent": theme.ui.accent,
    "--t-ink": theme.ui.ink,
    "--t-surface": theme.ui.surface,
    "--t-sky": theme.board.sky[0],
    "--t-ball": theme.board.ball,
    "--t-frame": theme.board.line,
    "--t-font": FONTS[theme.ui.font],
    "--t-display": FONTS[theme.ui.display],
  } as CSSProperties;
}

export { themeById };
export type { Theme };
