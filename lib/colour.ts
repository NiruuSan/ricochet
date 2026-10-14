// Colour arithmetic for the themes: parsing the hex the catalogue is written
// in, mixing, and the contrast rules that keep a brick's number readable.
//
// Shared by the board painter and the tests, so it imports nothing but types
// and touches nothing that only a browser has.

import type { Theme } from "./themes";

export type Rgba = [r: number, g: number, b: number, a: number];

const parsed = new Map<string, Rgba>();
/** `#rgb`, `#rrggbb` or `#rrggbbaa` as channels, alpha 0–1. */
export function rgba(hex: string): Rgba {
  const known = parsed.get(hex);
  if (known) return known;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const value: Rgba = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  parsed.set(hex, value);
  return value;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
/** Channels back to `#rrggbb`, opacity dropped. */
export const toHex = ([r, g, b]: Rgba | [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** `hex` moved `amount` of the way to `to`, at its own opacity unless `alpha` is given, as a CSS colour. */
export function mix(hex: string, to: string, amount: number, alpha?: number) {
  const [r, g, b, a] = rgba(hex);
  const [r2, g2, b2] = rgba(to);
  const m = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `rgba(${m(r, r2)},${m(g, g2)},${m(b, b2)},${alpha ?? a})`;
}
/** The same mix as `#rrggbb`, for when the result is mixed again or measured. */
export function mixHex(hex: string, to: string, amount: number) {
  const [r, g, b] = rgba(hex);
  const [r2, g2, b2] = rgba(to);
  return toHex([r + (r2 - r) * amount, g + (g2 - g) * amount, b + (b2 - b) * amount]);
}
/** The colour at another opacity. */
export const fade = (hex: string, alpha: number) => mix(hex, hex, 0, alpha);

/** A colour that may be see-through, as it looks laid over `under`. */
export function over(hex: string, under: string) {
  const [r, g, b, a] = rgba(hex);
  const [r2, g2, b2] = rgba(under);
  return toHex([r * a + r2 * (1 - a), g * a + g2 * (1 - a), b * a + b2 * (1 - a)]);
}

/** WCAG relative luminance. */
export function luminance(hex: string) {
  const [r, g, b] = rgba(hex).map((c, i) => {
    if (i === 3) return c;
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The bar a brick's number must clear against what is behind it. */
export const READABLE = 4.5;

/**
 * The colour to write on `background`: the theme's own when it reads well
 * there, otherwise its alternative, and black or white if neither will do.
 * A pale gem or a white chip gets a dark number; nothing is left to luck.
 */
export function readableOn(background: string, preferred: string, alternative: string) {
  if (contrast(preferred, background) >= READABLE) return preferred;
  const pick = (options: string[]) => options.reduce((best, c) => (contrast(c, background) > contrast(best, background) ? c : best));
  const themed = pick([preferred, alternative]);
  return contrast(themed, background) >= 3 ? themed : pick(["#ffffff", "#000000"]);
}

/** The colour of what is behind a brick's number, for each way of building a brick (app/arena/board-scenes.ts). */
export function labelBackground(theme: Theme, face: string, shade: string) {
  const sky = mixHex(theme.board.sky[0], theme.board.sky[1], 0.5);
  switch (theme.board.brick ?? "flat") {
    case "glossy":
      return mixHex(mixHex(face, "#ffffff", 0.18), mixHex(face, shade, 0.45), 0.5);
    case "neon":
      return neonInside(theme);
    case "chip":
      return mixHex(face, "#000000", 0.28);
    case "gradient":
      return mixHex(face, shade, 0.5);
    case "petal":
      return mixHex(face, "#ffffff", 0.15);
    case "magma":
      return mixHex(face, "#ffffff", 0.2);
    case "metal":
      return mixHex(face, shade, 0.1);
    default:
      return over(face, sky);
  }
}

/** The dark glass inside a brick drawn in light, dense enough that a sun behind it cannot wash a number out. */
export const neonInside = (theme: Theme) => mixHex(theme.board.sky[0], "#000000", 0.3);

/**
 * How a brick's number is written: its colour, and the opacity of a dark
 * outline round it (0 for none). A number outlined in dark is read against
 * its outline, which is what lets one colour sit on a bright gradient.
 */
export function brickLabel(theme: Theme, face: string, shade: string): { colour: string; outline: number } {
  if (theme.board.brick === "neon") return { colour: mixHex(face, "#ffffff", 0.4), outline: 0 };
  const preferred = theme.board.label === "tone" ? mixHex(shade, "#000000", 0.62) : theme.board.label;
  const outline = theme.board.outline ?? 0;
  if (outline) return { colour: preferred, outline };
  return { colour: readableOn(labelBackground(theme, face, shade), preferred, theme.board.labelAlt), outline: 0 };
}

/** The contrast a brick's number actually gets, outline included. */
export function labelContrast(theme: Theme, face: string, shade: string) {
  const { colour, outline } = brickLabel(theme, face, shade);
  const background = labelBackground(theme, face, shade);
  return contrast(colour, outline ? mixHex(background, "#000000", outline) : background);
}
