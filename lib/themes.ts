// The skins a player can put on the game.
//
// A theme is data, never code: colours, one brick shape, one set of effects and
// one typeface. The board it describes is the same board — the bricks sit in
// the same cells, the balls bounce off the same edges (lib/engine.ts owns the
// geometry, and `brickBounds` never reads anything here). A theme cannot make a
// shot easier or harder, which is why it can be sold.
//
// Everything below is shared by the browser that paints it and the server that
// sells it, so this file imports nothing that only one of them has.

export type ThemeId =
  | "classic"
  | "neon"
  | "paper"
  | "arcade"
  | "deep"
  | "terminal"
  | "sakura"
  | "obsidian"
  | "solar"
  | "void";

/** Typefaces, loaded once in the layout and named here by their CSS variable. */
export type FontKey = "system" | "orbitron" | "pixel" | "serif" | "mono" | "round";

/** Bricks break into something. Each burst is drawn by app/arena/board-effects.ts. */
export type Burst = "shards" | "sparks" | "pixels" | "bubbles" | "petals" | "embers" | "dust" | "glyphs" | "scraps";
/** What a ball leaves behind where it strikes. */
export type Bounce = "none" | "ring" | "spark" | "ripple";
/** The celebration when a board is cleared. */
export type Clear = "wash" | "rays" | "confetti" | "shockwave";

export type Theme = {
  id: ThemeId;
  name: string;
  /** One line, in the store. */
  tagline: string;
  /** Null for the theme everybody starts with. */
  price: { asset: "gems"; amount: number } | { asset: "devnet"; amount: number } | null;
  board: {
    /** Behind everything. Two stops make a gradient; one is flat. */
    sky: [string, string];
    /** Below the launch line. */
    floor: string;
    line: string;
    /** The dotted grid, or null for a board with nothing behind the bricks. */
    dots: string | null;
    /** Face and shade for each brick colour, cycled per column and round. */
    bricks: [face: string, shade: string][];
    /** The number on a brick. */
    label: string;
    /** A lighter band across the top of a brick, or null for a flat face. */
    shine: string | null;
    /** Corner radius in board units: 0 is a square brick, 7 is today's. */
    radius: number;
    /** An outline around each brick, for themes made of glass or light. */
    stroke: string | null;
    ball: string;
    glow: string;
    /** The aim guide, as `r, g, b` so the dots can fade along the line. */
    aim: string;
  };
  effects: { burst: Burst; bounce: Bounce; trail: boolean; clear: Clear };
  /** The screens around the board: accent, text, panels, and the typefaces. */
  ui: { accent: string; ink: string; surface: string; font: FontKey; display: FontKey };
};

/**
 * The catalogue. Ten looks that should never be mistaken for one another at a
 * glance: three of them light or near-light, three built on squares, and every
 * one with its own break, bounce and clear.
 */
export const THEMES: Theme[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "The board as it has always been: midnight blue, lime, and a good angle.",
    price: null,
    board: {
      sky: ["#0c1422", "#0c1422"],
      floor: "#111d2d",
      line: "#29374b",
      dots: "#263247",
      bricks: [
        ["#bb8cff", "#8260b7"],
        ["#68d9d6", "#368887"],
        ["#ffd17b", "#a58042"],
        ["#9fccfc", "#5b7fac"],
        ["#fa98b4", "#9b536c"],
        ["#c6f564", "#809e3e"],
      ],
      label: "#162238",
      shine: "#ffffff38",
      radius: 7,
      stroke: null,
      ball: "#ddffab",
      glow: "#c6f564",
      aim: "198, 245, 100",
    },
    effects: { burst: "shards", bounce: "none", trail: false, clear: "wash" },
    ui: { accent: "#c6f564", ink: "#e7edf7", surface: "#111826", font: "system", display: "system" },
  },
  {
    id: "neon",
    name: "Neon Grid",
    tagline: "A city at 3am. Magenta, cyan, and a horizon that will not stop glowing.",
    price: { asset: "gems", amount: 2_500 },
    board: {
      sky: ["#1a0b2e", "#2d0b45"],
      floor: "#120724",
      line: "#ff3df0",
      dots: "#5b2a8c",
      bricks: [
        ["#ff3df0", "#8c1c86"],
        ["#00f0ff", "#00808a"],
        ["#ffe600", "#8a7c00"],
        ["#7b5cff", "#3d2a8a"],
        ["#ff6b9d", "#8a3a56"],
        ["#39ff88", "#1c8a49"],
      ],
      label: "#1a0b2e",
      shine: "#ffffff55",
      radius: 0,
      stroke: "#ffffff2e",
      ball: "#ffffff",
      glow: "#00f0ff",
      aim: "255, 61, 240",
    },
    effects: { burst: "sparks", bounce: "spark", trail: true, clear: "rays" },
    ui: { accent: "#ff3df0", ink: "#f3e9ff", surface: "#1d0e33", font: "orbitron", display: "orbitron" },
  },
  {
    id: "paper",
    name: "Paper Cut",
    tagline: "Daylight, at last. Cut paper on a cream page, with scraps that fall when it tears.",
    price: { asset: "gems", amount: 4_000 },
    board: {
      sky: ["#f6f1e4", "#efe7d6"],
      floor: "#e3d9c4",
      line: "#b9ac91",
      dots: "#d9cfb9",
      bricks: [
        ["#e8705a", "#b8503e"],
        ["#4f9d86", "#357061"],
        ["#e8b64c", "#b88b33"],
        ["#5d7fb9", "#41598450"],
        ["#c46a9e", "#8f4874"],
        ["#7aa653", "#55763a"],
      ],
      label: "#3a3222",
      shine: "#ffffff70",
      radius: 3,
      stroke: "#00000018",
      ball: "#2f2a20",
      glow: "#00000000",
      aim: "80, 72, 56",
    },
    effects: { burst: "scraps", bounce: "none", trail: false, clear: "confetti" },
    ui: { accent: "#e8705a", ink: "#2f2a20", surface: "#fbf7ee", font: "serif", display: "serif" },
  },
  {
    id: "arcade",
    name: "Arcade 84",
    tagline: "Four colours, square corners and a screen that hums. Bring coins.",
    price: { asset: "gems", amount: 6_000 },
    board: {
      sky: ["#0b0b0b", "#141414"],
      floor: "#050505",
      line: "#f8f8f8",
      dots: "#272727",
      bricks: [
        ["#ff0044", "#a3002b"],
        ["#ffcc00", "#a38200"],
        ["#00d1ff", "#0085a3"],
        ["#00ff66", "#00a341"],
        ["#ff7a00", "#a34e00"],
        ["#ffffff", "#a3a3a3"],
      ],
      label: "#0b0b0b",
      shine: null,
      radius: 0,
      stroke: "#00000000",
      ball: "#ffffff",
      glow: "#ffcc00",
      aim: "255, 204, 0",
    },
    effects: { burst: "pixels", bounce: "none", trail: false, clear: "shockwave" },
    ui: { accent: "#ffcc00", ink: "#f8f8f8", surface: "#151515", font: "system", display: "pixel" },
  },
  {
    id: "deep",
    name: "Deep Sea",
    tagline: "Far under. Coral bricks, a wake behind the ball, and bubbles on the way up.",
    price: { asset: "gems", amount: 8_000 },
    board: {
      sky: ["#022b3a", "#04121c"],
      floor: "#02202b",
      line: "#1f7a8c",
      dots: "#0b4a5e",
      bricks: [
        ["#57cc99", "#2f7d5c"],
        ["#38a3a5", "#1f6567"],
        ["#80ed99", "#4a9159"],
        ["#c7f9cc", "#77a87b"],
        ["#22577a", "#143549"],
        ["#f4a261", "#96602f"],
      ],
      label: "#04121c",
      shine: "#ffffff30",
      radius: 12,
      stroke: null,
      ball: "#e0fbfc",
      glow: "#57cc99",
      aim: "128, 237, 153",
    },
    effects: { burst: "bubbles", bounce: "ripple", trail: true, clear: "wash" },
    ui: { accent: "#57cc99", ink: "#e0fbfc", surface: "#06283a", font: "round", display: "round" },
  },
  {
    id: "terminal",
    name: "Terminal",
    tagline: "Green phosphor, no decoration, and characters falling out of every brick.",
    price: { asset: "gems", amount: 12_000 },
    board: {
      sky: ["#000e04", "#001a08"],
      floor: "#000a03",
      line: "#00ff6a",
      dots: "#004d20",
      bricks: [
        ["#00ff6a", "#008035"],
        ["#00c853", "#00642a"],
        ["#9dff00", "#4e8000"],
        ["#00ffa3", "#008052"],
        ["#66ff99", "#33804d"],
        ["#00e676", "#007338"],
      ],
      label: "#001a08",
      shine: null,
      radius: 0,
      stroke: "#00ff6a55",
      ball: "#d4ffe4",
      glow: "#00ff6a",
      aim: "0, 255, 106",
    },
    effects: { burst: "glyphs", bounce: "none", trail: false, clear: "rays" },
    ui: { accent: "#00ff6a", ink: "#c8ffdd", surface: "#001208", font: "mono", display: "mono" },
  },
  {
    id: "sakura",
    name: "Sakura",
    tagline: "Dusk over the blossom. Soft bricks, and petals that drift down when one goes.",
    price: { asset: "gems", amount: 20_000 },
    board: {
      sky: ["#2b1b2e", "#4a2440"],
      floor: "#231624",
      line: "#e8a0bf",
      dots: "#5d3352",
      bricks: [
        ["#ffb3c6", "#a86b7e"],
        ["#ffc8dd", "#a87e94"],
        ["#cdb4db", "#85738f"],
        ["#bde0fe", "#7a92a8"],
        ["#ffafcc", "#a8708a"],
        ["#f7d6e0", "#a18d94"],
      ],
      label: "#2b1b2e",
      shine: "#ffffff4a",
      radius: 10,
      stroke: null,
      ball: "#fff0f6",
      glow: "#ffb3c6",
      aim: "255, 179, 198",
    },
    effects: { burst: "petals", bounce: "none", trail: true, clear: "wash" },
    ui: { accent: "#ffb3c6", ink: "#fff0f6", surface: "#322034", font: "round", display: "serif" },
  },
  {
    id: "obsidian",
    name: "Obsidian & Gold",
    tagline: "Black stone, gold leaf, and dust that hangs in the air after a break.",
    price: { asset: "devnet", amount: 250_000_000 },
    board: {
      sky: ["#0a0a0c", "#131318"],
      floor: "#07070a",
      line: "#c9a227",
      dots: "#26262e",
      bricks: [
        ["#e8c766", "#967c24"],
        ["#c9a227", "#7d6416"],
        ["#f2e2b1", "#a1936f"],
        ["#8c7853", "#5a4d33"],
        ["#d4af37", "#856d1f"],
        ["#efe1c0", "#9c9079"],
      ],
      label: "#0a0a0c",
      shine: "#fff6d980",
      radius: 0,
      stroke: "#c9a22766",
      ball: "#f6e7b4",
      glow: "#c9a227",
      aim: "201, 162, 39",
    },
    effects: { burst: "dust", bounce: "ring", trail: false, clear: "rays" },
    ui: { accent: "#c9a227", ink: "#f2e9d2", surface: "#111116", font: "serif", display: "serif" },
  },
  {
    id: "solar",
    name: "Solar Flare",
    tagline: "Something molten. Embers climb from every brick you take apart.",
    price: { asset: "devnet", amount: 500_000_000 },
    board: {
      sky: ["#1a0a05", "#3d1205"],
      floor: "#140704",
      line: "#ff7b29",
      dots: "#5c2410",
      bricks: [
        ["#ffd166", "#a6852f"],
        ["#ff9f1c", "#a6640f"],
        ["#ff6b35", "#a63f1c"],
        ["#f94144", "#a12628"],
        ["#ffbf69", "#a67a3c"],
        ["#fff3b0", "#a69c67"],
      ],
      label: "#1a0a05",
      shine: "#fff1c980",
      radius: 4,
      stroke: null,
      ball: "#fff6e0",
      glow: "#ff7b29",
      aim: "255, 123, 41",
    },
    effects: { burst: "embers", bounce: "spark", trail: true, clear: "shockwave" },
    ui: { accent: "#ff7b29", ink: "#ffe9d0", surface: "#23100a", font: "orbitron", display: "orbitron" },
  },
  {
    id: "void",
    name: "Void",
    tagline: "Deep space, glass bricks and a comet where the ball used to be.",
    price: { asset: "devnet", amount: 1_000_000_000 },
    board: {
      sky: ["#05040f", "#0d0b26"],
      floor: "#04030c",
      line: "#6c5ce7",
      dots: "#ffffff22",
      bricks: [
        ["#a29bfe57", "#6c5ce7"],
        ["#74b9ff57", "#0984e3"],
        ["#81ecec57", "#00cec9"],
        ["#fd79a857", "#e84393"],
        ["#ffeaa757", "#fdcb6e"],
        ["#dfe6e957", "#b2bec3"],
      ],
      label: "#f1f2ff",
      shine: "#ffffff2e",
      radius: 2,
      stroke: "#ffffff66",
      ball: "#ffffff",
      glow: "#a29bfe",
      aim: "162, 155, 254",
    },
    effects: { burst: "shards", bounce: "ring", trail: true, clear: "shockwave" },
    ui: { accent: "#a29bfe", ink: "#eef0ff", surface: "#0b0a1c", font: "orbitron", display: "orbitron" },
  },
];

export const DEFAULT_THEME: ThemeId = "classic";
export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
/** Every theme a player owns without buying it. */
export const isFreeTheme = (id: string) => THEMES.some((t) => t.id === id && t.price === null);
