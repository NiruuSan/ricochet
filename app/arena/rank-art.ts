import type { RankTier } from "@/lib/levels";

// The rank insignia, drawn as SVG.
//
// Every rank is a bevelled hexagon of its tier's metal around a dark plate, and
// what is struck on the plate climbs with the rank, the way a military
// insignia does: chevrons for Iron, stacked plates for Bronze, a star over the
// chevrons for Silver, two for Gold; then wings for Platinum, a laurel wreath
// as well for Diamond, and for Bouncer one great star.
//
// Two levels of detail: the full insignia for anything shown at a real size,
// and a compact one — thicker, the tier's mark alone, no wreath — for the
// fourteen-pixel badge beside a name, where fine lines would only blur. The
// division is in the name written beside it.

type Metal = {
  /** Highlight, face, shadow and edge, light to dark. */
  light: string;
  face: string;
  shadow: string;
  edge: string;
  /** The plate the emblem is struck on: centre and rim. */
  plate: string;
  rim: string;
};

/** A rank to draw: a tier, or "unranked" before the placement games are played. */
export type RankLook = RankTier | "unranked";

const METALS: Record<RankLook, Metal> = {
  unranked: { light: "#aab3c0", face: "#5d6674", shadow: "#363d48", edge: "#1a1e25", plate: "#1b2029", rim: "#0d1015" },
  iron: { light: "#c9d0da", face: "#7e8897", shadow: "#47505d", edge: "#1f242b", plate: "#23282f", rim: "#111418" },
  bronze: { light: "#ffe0bd", face: "#d8925a", shadow: "#8f5226", edge: "#4a2610", plate: "#3d2214", rim: "#1c0e07" },
  silver: { light: "#ffffff", face: "#dfe7f3", shadow: "#94a3ba", edge: "#46526a", plate: "#24304a", rim: "#101626" },
  gold: { light: "#fff5c4", face: "#ffc93f", shadow: "#c27912", edge: "#6b3a05", plate: "#5a1d10", rim: "#2a0b05" },
  platinum: { light: "#f2ffff", face: "#9ee8e2", shadow: "#47a3a3", edge: "#1c5556", plate: "#0f3236", rim: "#061719" },
  diamond: { light: "#f5fbff", face: "#a9d2ff", shadow: "#5786de", edge: "#22377f", plate: "#14214a", rim: "#080d24" },
  bouncer: { light: "#fbffe2", face: "#cff76c", shadow: "#7ca52a", edge: "#3a5410", plate: "#1d2a09", rim: "#0b1103" },
};

/** The colour a rank is known by, for charts and accents. */
export const rankColor = (tier: RankLook) => METALS[tier].face;

/** A rank's metal from its highlight to its shade, for what is drawn around the insignia. */
export const rankMetal = (tier: RankLook) => ({ light: METALS[tier].light, face: METALS[tier].face, shadow: METALS[tier].shadow });

/** Ranks that wear wings, and the ones with a wreath as well. */
const WINGED: RankLook[] = ["platinum", "diamond", "bouncer"];
const WREATHED: RankLook[] = ["diamond", "bouncer"];

const CX = 50;
const CY = 50;

const f = (n: number) => Math.round(n * 100) / 100;
const pts = (points: [number, number][]) => points.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

/** A pointy-topped hexagon's corners, top first, clockwise. */
function hexagon(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Mixes two `#rrggbb` colours. */
function blend(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The metal at a lighting from -1 (facing away) to 1 (facing the light). */
function lit(m: Metal, light: number) {
  return light >= 0 ? blend(m.face, m.light, light * 0.85) : blend(m.face, m.shadow, -light);
}

/** A five-pointed star. */
function star(cx: number, cy: number, r: number, inner = 0.45): [number, number][] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const radius = i % 2 ? r * inner : r;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
}

/** A chevron pointing down, `w` wide and `t` thick, its top edge at `y`. */
function chevron(y: number, w: number, t: number, depth: number): [number, number][] {
  const h = w / 2;
  return [
    [CX - h, y],
    [CX, y + depth],
    [CX + h, y],
    [CX + h, y + t],
    [CX, y + depth + t],
    [CX - h, y + t],
  ];
}

export type RankArt = { viewBox: string; width: number; body: string };

/**
 * The insignia for a rank, as the inside of an `<svg>` and the box it needs.
 * `width` is relative to a height of 1: winged ranks are wider. `id` keeps the
 * gradients of two badges on one page apart.
 */
export function rankArt(tier: RankLook, division: 1 | 2 | 3 | null, id: string, compact = false): RankArt {
  const m = METALS[tier];
  const winged = WINGED.includes(tier);
  const wreathed = !compact && WREATHED.includes(tier);
  const g = (name: string) => `${id}-${name}`;
  const out: string[] = [];
  const defs: string[] = [];

  // Gradients: the metal running top to bottom, the plate lit from its middle.
  defs.push(
    `<linearGradient id="${g("metal")}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${m.light}"/><stop offset=".45" stop-color="${m.face}"/><stop offset="1" stop-color="${m.shadow}"/></linearGradient>`,
    `<linearGradient id="${g("emblem")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.light}"/><stop offset=".55" stop-color="${m.face}"/><stop offset="1" stop-color="${blend(m.face, m.shadow, 0.7)}"/></linearGradient>`,
    `<radialGradient id="${g("plate")}" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="${blend(m.plate, m.face, 0.16)}"/><stop offset=".7" stop-color="${m.plate}"/><stop offset="1" stop-color="${m.rim}"/></radialGradient>`,
  );
  if (tier === "bouncer") defs.push(`<radialGradient id="${g("aura")}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8ff9e" stop-opacity=".55"/><stop offset="1" stop-color="#c6f564" stop-opacity="0"/></radialGradient>`);

  const emblem = `fill="url(#${g("emblem")})" stroke="${m.edge}" stroke-width="${compact ? 2.4 : 1.3}" stroke-linejoin="round"`;
  const outer = compact ? 47 : 44;
  const inner = compact ? 34 : 35.5;

  if (tier === "bouncer" && !compact) out.push(`<circle cx="${CX}" cy="${CY}" r="60" fill="url(#${g("aura")})"/>`);
  if (winged) out.push(wings(m, compact));

  // The frame: a thickness under it, then six facets lit from the top left.
  if (!compact) out.push(`<polygon points="${pts(hexagon(CX, CY + 4, outer))}" fill="${m.edge}"/>`);
  const o = hexagon(CX, CY, outer);
  const i = hexagon(CX, CY, inner);
  if (compact) {
    out.push(`<polygon points="${pts(o)}" fill="url(#${g("metal")})" stroke="${m.edge}" stroke-width="2.4" stroke-linejoin="round"/>`);
  } else {
    // Each side's outward normal, against a light up and to the left.
    const light = [-0.53, -0.85];
    for (let k = 0; k < 6; k++) {
      const a = ((-60 + k * 60) * Math.PI) / 180;
      const facing = Math.cos(a) * light[0] + Math.sin(a) * light[1];
      out.push(`<polygon points="${pts([o[k], o[(k + 1) % 6], i[(k + 1) % 6], i[k]])}" fill="${lit(m, facing)}"/>`);
    }
    out.push(`<polygon points="${pts(o)}" fill="none" stroke="${m.edge}" stroke-width="1.6" stroke-linejoin="round"/>`);
    out.push(`<polyline points="${pts([o[4], o[5], o[0]])}" fill="none" stroke="${m.light}" stroke-opacity=".9" stroke-width="1.2" stroke-linejoin="round"/>`);
  }
  // The plate, sunk into the frame.
  out.push(`<polygon points="${pts(i)}" fill="url(#${g("plate")})" stroke="${m.edge}" stroke-width="${compact ? 1.6 : 1.4}" stroke-linejoin="round"/>`);
  if (!compact) out.push(`<polyline points="${pts([i[1], i[2], i[3]])}" fill="none" stroke="${m.face}" stroke-opacity=".35" stroke-width="1.1"/>`);

  if (wreathed) out.push(wreath(m));
  out.push(mark(tier, compact ? 1 : division ?? 1, compact, emblem));

  // A glint on the frame's lit corner.
  if (!compact) out.push(`<path d="M${f(o[5][0] + 3)} ${f(o[5][1] + 2)} l3 -1.6 -1.1 3.2z" fill="#fff" opacity=".85"/>`);

  // Winged ranks need room either side of the hexagon.
  const viewBox = winged ? (compact ? "-22 -2 144 104" : "-20 -4 140 108") : compact ? "-2 -2 104 104" : "-2 -4 104 108";
  const [, , w, h] = viewBox.split(" ").map(Number);
  return { viewBox, width: w / h, body: `<defs>${defs.join("")}</defs>${out.join("")}` };
}

/** What is struck on the plate: the rank's mark, `n` times over where it counts. */
function mark(tier: RankLook, n: number, compact: boolean, emblem: string) {
  const shapes: string[] = [];
  const poly = (p: [number, number][]) => shapes.push(`<polygon points="${pts(p)}" ${emblem}/>`);
  const chevrons = (count: number, top: number, w = 32, t = 6.5, depth = 9, gap = 9) => {
    for (let k = 0; k < count; k++) poly(chevron(top + k * gap, w, t, depth));
  };
  /** The height a stack of chevrons takes, to centre it. */
  const stack = (count: number, t = 6.5, depth = 9, gap = 9) => depth + t + (count - 1) * gap;

  if (tier === "unranked") {
    // Not yet placed: a question mark struck on the plate.
    const w = compact ? 5.5 : 4.2;
    shapes.push(
      `<path d="M${CX - 10} ${CY - 8}c0-7 4.5-11 10-11s10 4 10 10c0 7-9 7-9 15" fill="none" stroke="${METALS.unranked.light}" stroke-width="${w}" stroke-linecap="round"/>`,
      `<circle cx="${CX + 1}" cy="${CY + 17}" r="${w * 0.75}" fill="${METALS.unranked.light}"/>`,
    );
    return shapes.join("");
  }
  if (compact) {
    switch (tier) {
      case "iron":
        chevrons(1, CY - 9, 40, 10, 11);
        break;
      case "bronze":
        poly([
          [CX, CY - 13],
          [CX + 20, CY],
          [CX, CY + 13],
          [CX - 20, CY],
        ]);
        break;
      default:
        poly(star(CX, CY + 1, tier === "bouncer" ? 23 : 20, tier === "bouncer" ? 0.42 : 0.46));
    }
    return shapes.join("");
  }

  switch (tier) {
    case "iron": {
      chevrons(n, CY - stack(n) / 2);
      break;
    }
    case "bronze": {
      // Plates stacked one on another, seen from above at an angle.
      const total = 16 + (n - 1) * 8;
      for (let k = n - 1; k >= 0; k--) {
        const y = CY - total / 2 + 8 + k * 8;
        shapes.push(`<polygon points="${pts([
          [CX - 19, y],
          [CX, y + 9],
          [CX + 19, y],
          [CX + 19, y + 4.5],
          [CX, y + 13.5],
          [CX - 19, y + 4.5],
        ])}" ${emblem} fill-opacity=".9"/>`);
        poly([
          [CX, y - 9],
          [CX + 19, y],
          [CX, y + 9],
          [CX - 19, y],
        ]);
      }
      break;
    }
    case "silver": {
      const h = 19 + 3 + stack(n);
      const top = CY - h / 2;
      poly(star(CX, top + 9.5, 10.5));
      chevrons(n, top + 22);
      break;
    }
    case "gold": {
      // A star either side of the chevrons, at their height: an insignia, never a face.
      const top = CY - stack(n) / 2;
      chevrons(n, top, 26, 6, 8, 8.5);
      poly(star(CX - 23, CY, 7.5));
      poly(star(CX + 23, CY, 7.5));
      break;
    }
    case "platinum":
    case "diamond": {
      // One star, two side by side, or three in a pyramid; above the wreath on Diamond.
      const y = tier === "diamond" ? CY - 3 : CY;
      if (n === 1) poly(star(CX, y + 1, tier === "diamond" ? 13 : 15));
      if (n === 2) {
        poly(star(CX - 10.5, y + 1, 9.5));
        poly(star(CX + 10.5, y + 1, 9.5));
      }
      if (n === 3) {
        poly(star(CX, y - 7.5, 9));
        poly(star(CX - 11, y + 8, 9));
        poly(star(CX + 11, y + 8, 9));
      }
      break;
    }
    case "bouncer": {
      poly(star(CX, CY - 2, 19, 0.42));
      // The star's ridges, so it reads as struck metal rather than a cut-out.
      const tips = star(CX, CY - 2, 19, 0.42);
      const ridges = tips.filter((_, k) => k % 2 === 0).map(([x, y]) => `M${CX} ${CY - 2}L${f(x)} ${f(y)}`).join("");
      shapes.push(`<path d="${ridges}" stroke="#fffbe0" stroke-opacity=".55" stroke-width="1" fill="none"/>`);
      break;
    }
  }
  return shapes.join("");
}

/** Three feathers a side, the top one longest, struck in the tier's metal. */
function wings(m: Metal, compact: boolean) {
  const feathers = compact ? 2 : 3;
  const parts: string[] = [];
  for (const side of [-1, 1]) {
    for (let k = feathers - 1; k >= 0; k--) {
      const base = CX + side * (compact ? 28 : 31);
      const y = CY - (compact ? 18 : 18) + k * (compact ? 15 : 11);
      const length = (compact ? 46 : 36) - k * (compact ? 9 : 7);
      const tip = base + side * length;
      const h = compact ? 11 : 9;
      const shape: [number, number][] = [
        [base, y + 2],
        [tip, y - 4 + k * 1.5],
        [tip - side * (compact ? 5 : 6), y + h - 2],
        [base, y + h + 2],
      ];
      parts.push(`<polygon points="${pts(shape)}" fill="${lit(m, k === 0 ? 0.65 : k === 1 ? 0.15 : -0.35)}" stroke="${m.edge}" stroke-width="${compact ? 2.2 : 1.3}" stroke-linejoin="round"/>`);
      if (!compact) parts.push(`<line x1="${f(base + side * 2)}" y1="${f(y + 3)}" x2="${f(tip - side * 3)}" y2="${f(y - 2.5 + k * 1.5)}" stroke="${m.light}" stroke-opacity=".7" stroke-width="1"/>`);
    }
  }
  return parts.join("");
}

/** A laurel wreath round the bottom of the plate. */
function wreath(m: Metal) {
  const parts: string[] = [];
  const r = 24;
  const cy = CY + 2;
  for (const side of [-1, 1]) {
    // The stem.
    const from = 100;
    const to = 205;
    const arc = (deg: number) => {
      const a = ((side < 0 ? deg : 180 - deg) * Math.PI) / 180;
      return [CX + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
    };
    const [sx, sy] = arc(from);
    const [ex, ey] = arc(to);
    parts.push(`<path d="M${f(sx)} ${f(sy)} A${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${f(ex)} ${f(ey)}" fill="none" stroke="${m.shadow}" stroke-width="1.4"/>`);
    // Leaves along it, pointing up the stem.
    for (let deg = from + 8; deg <= to; deg += 17) {
      const [x, y] = arc(deg);
      const tangent = side < 0 ? deg + 90 : 90 - deg;
      for (const lean of [-38, 38]) {
        parts.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="4.6" ry="1.9" transform="rotate(${f(tangent + lean + (side < 0 ? 180 : 0))} ${f(x)} ${f(y)}) translate(${side < 0 ? -3 : 3} 0)" fill="${lit(m, 0.35)}" stroke="${m.edge}" stroke-width=".7"/>`);
      }
    }
  }
  return parts.join("");
}
