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
  | "void"
  | "candy"
  | "frost"
  | "sumi"
  | "outrun"
  | "crystal"
  | "mainnet"
  | "aurora"
  | "highroller";

/** Typefaces, loaded once in the layout and named here by their CSS variable. */
export type FontKey = "system" | "orbitron" | "pixel" | "serif" | "mono" | "round";

/** Bricks break into something. Each burst is drawn by app/arena/board-effects.ts. */
export type Burst =
  | "shards"
  | "sparks"
  | "pixels"
  | "bubbles"
  | "petals"
  | "embers"
  | "dust"
  | "glyphs"
  | "scraps"
  | "crystals"
  | "stars"
  | "snow"
  | "ink"
  | "coins"
  | "sprinkles";
/** What a ball leaves behind where it strikes. */
export type Bounce = "none" | "ring" | "spark" | "ripple";
/** The celebration when a board is cleared. */
export type Clear = "wash" | "rays" | "confetti" | "shockwave" | "fireworks" | "jackpot";

/**
 * A picture behind the bricks, painted by app/arena/board-scenes.ts. Some move
 * (stars twinkle, snow falls, the aurora drifts); none of them is ever in front
 * of a brick or the ball, so nothing on the board is harder to read.
 */
export type Scene = "stars" | "aurora" | "outrun" | "ink" | "snow" | "cave" | "felt" | "pulse" | "candy";
/** How a brick is built: flat paint, or something with depth. Same cell, same size, whichever. */
export type BrickStyle = "flat" | "glossy" | "gem" | "glass" | "neon" | "chip" | "ink" | "gradient";

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
    /** A picture behind the bricks; none when absent. */
    scene?: Scene;
    /** How bricks are drawn; flat when absent. For "gradient" the shade is the second colour. */
    brick?: BrickStyle;
    /** A ball lit from one side, like a sphere, instead of a flat disc. */
    orb?: boolean;
  };
  effects: { burst: Burst; bounce: Bounce; trail: boolean; clear: Clear };
  /** The screens around the board: accent, text, panels, and the typefaces. */
  ui: { accent: string; ink: string; surface: string; font: FontKey; display: FontKey };
};

/**
 * The catalogue. Eighteen looks that should never be mistaken for one another
 * at a glance, from the free board to the gold-rimmed table: every one with its
 * own break, bounce and clear, and the later ones with a scene behind the board
 * and bricks with real depth.
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
  {
    id: "candy",
    name: "Candy Pop",
    tagline: "Jelly bricks, a sugar-pink sky and sprinkles everywhere a brick gives way.",
    price: { asset: "gems", amount: 5_000 },
    board: {
      sky: ["#ffe1f0", "#d6efff"],
      floor: "#ffd0e8",
      line: "#ff8fc4",
      dots: null,
      bricks: [
        ["#ff6fae", "#d1407f"],
        ["#ffb347", "#d9822b"],
        ["#5fdcff", "#2ba6cf"],
        ["#b38bff", "#7f5ad6"],
        ["#6ff09a", "#36b864"],
        ["#ffdc5e", "#d4ac2c"],
      ],
      label: "#ffffff",
      shine: null,
      radius: 18,
      stroke: null,
      ball: "#ffffff",
      glow: "#ff6fae",
      aim: "255, 111, 174",
      scene: "candy",
      brick: "glossy",
      orb: true,
    },
    effects: { burst: "sprinkles", bounce: "ring", trail: false, clear: "confetti" },
    ui: { accent: "#ff4f9a", ink: "#3d1730", surface: "#fff4fa", font: "round", display: "round" },
  },
  {
    id: "frost",
    name: "Frostbite",
    tagline: "A winter night. Bricks of clear ice, snow that never stops, and frost when one shatters.",
    price: { asset: "gems", amount: 9_000 },
    board: {
      sky: ["#06162c", "#17466f"],
      floor: "#0a213a",
      line: "#9ad8ff",
      dots: null,
      bricks: [
        ["#bfe9ff73", "#6fb8e0"],
        ["#e6f7ff66", "#9ccbe6"],
        ["#8fd3ff73", "#4a9fd1"],
        ["#c9d8ff73", "#7d92d6"],
        ["#a6f0ff73", "#55b9cc"],
        ["#ffffff59", "#b7d3e6"],
      ],
      label: "#ffffff",
      shine: "#ffffffa0",
      radius: 6,
      stroke: "#e8f7ffb3",
      ball: "#ffffff",
      glow: "#9ad8ff",
      aim: "180, 225, 255",
      scene: "snow",
      brick: "glass",
      orb: true,
    },
    effects: { burst: "crystals", bounce: "ring", trail: true, clear: "shockwave" },
    ui: { accent: "#9ad8ff", ink: "#eaf7ff", surface: "#0b2140", font: "round", display: "round" },
  },
  {
    id: "sumi",
    name: "Sumi-e",
    tagline: "Ink on rice paper under a red sun. Every brick a brushstroke, every break a blot.",
    price: { asset: "gems", amount: 15_000 },
    board: {
      sky: ["#f5eddc", "#eadcc0"],
      floor: "#e3d2b2",
      line: "#5b4a3a",
      dots: null,
      bricks: [
        ["#1f1c1a", "#000000"],
        ["#3d3732", "#16130f"],
        ["#b8312f", "#7a1f1d"],
        ["#57514a", "#2a2622"],
        ["#2b2622", "#0d0b0a"],
        ["#8f2b25", "#5a1814"],
      ],
      label: "#f5eddc",
      shine: null,
      radius: 2,
      stroke: null,
      ball: "#b8312f",
      glow: "#00000000",
      aim: "70, 56, 44",
      scene: "ink",
      brick: "ink",
    },
    effects: { burst: "ink", bounce: "none", trail: false, clear: "wash" },
    ui: { accent: "#b8312f", ink: "#2a2420", surface: "#f8f1e3", font: "serif", display: "serif" },
  },
  {
    id: "outrun",
    name: "Outrun",
    tagline: "Midnight on an endless highway: a striped sun, a moving grid, and bricks drawn in light.",
    price: { asset: "gems", amount: 25_000 },
    board: {
      sky: ["#0b0120", "#3a0a5e"],
      floor: "#0b0120",
      line: "#ff2bd6",
      dots: null,
      bricks: [
        ["#ff2bd6", "#ff2bd6"],
        ["#00e5ff", "#00e5ff"],
        ["#ffd319", "#ffd319"],
        ["#ff7a18", "#ff7a18"],
        ["#b967ff", "#b967ff"],
        ["#05ffa1", "#05ffa1"],
      ],
      label: "#ffffff",
      shine: null,
      radius: 3,
      stroke: null,
      ball: "#ffffff",
      glow: "#ff2bd6",
      aim: "255, 43, 214",
      scene: "outrun",
      brick: "neon",
      orb: true,
    },
    effects: { burst: "sparks", bounce: "spark", trail: true, clear: "fireworks" },
    ui: { accent: "#ff2bd6", ink: "#ffe9fb", surface: "#1a0633", font: "orbitron", display: "orbitron" },
  },
  {
    id: "crystal",
    name: "Crystal Cavern",
    tagline: "Deep in the rock, cut gems catch a light from nowhere and burst into shards.",
    price: { asset: "gems", amount: 40_000 },
    board: {
      sky: ["#0a0517", "#1c0f33"],
      floor: "#07030f",
      line: "#9b5de5",
      dots: null,
      bricks: [
        ["#a46bf0", "#55288f"],
        ["#3a86ff", "#1a4699"],
        ["#06d6a0", "#037a5c"],
        ["#ef476f", "#8f2140"],
        ["#ffd166", "#a8822a"],
        ["#4cc9f0", "#1f7d99"],
      ],
      label: "#ffffff",
      shine: null,
      radius: 3,
      stroke: "#ffffff40",
      ball: "#ffffff",
      glow: "#c77dff",
      aim: "199, 125, 255",
      scene: "cave",
      brick: "gem",
      orb: true,
    },
    effects: { burst: "crystals", bounce: "spark", trail: true, clear: "fireworks" },
    ui: { accent: "#c77dff", ink: "#f1e8ff", surface: "#140b24", font: "system", display: "serif" },
  },
  {
    id: "mainnet",
    name: "Mainnet",
    tagline: "Purple to green, block after block. For the ones who were here before the airdrop.",
    price: { asset: "devnet", amount: 500_000_000 },
    board: {
      sky: ["#07070f", "#140b2a"],
      floor: "#07070f",
      line: "#14f195",
      dots: null,
      bricks: [
        ["#9945ff", "#14f195"],
        ["#14f195", "#00c2ff"],
        ["#00c2ff", "#9945ff"],
        ["#dc1fff", "#00ffa3"],
        ["#7b61ff", "#03e1ff"],
        ["#00ffa3", "#dc1fff"],
      ],
      label: "#ffffff",
      shine: "#ffffff45",
      radius: 10,
      stroke: "#ffffff26",
      ball: "#ffffff",
      glow: "#14f195",
      aim: "20, 241, 149",
      scene: "pulse",
      brick: "gradient",
      orb: true,
    },
    effects: { burst: "pixels", bounce: "ring", trail: true, clear: "shockwave" },
    ui: { accent: "#14f195", ink: "#eafff6", surface: "#100d1f", font: "orbitron", display: "orbitron" },
  },
  {
    id: "aurora",
    name: "Aurora",
    tagline: "The northern lights, alive over the ridge. Glass bricks, and stars where they break.",
    price: { asset: "devnet", amount: 750_000_000 },
    board: {
      sky: ["#010611", "#062038"],
      floor: "#010812",
      line: "#5cffc6",
      dots: null,
      bricks: [
        ["#5cffc661", "#2fb38a"],
        ["#8f7cff61", "#5a45c9"],
        ["#3ad6ff61", "#1f8db3"],
        ["#ff7ad961", "#b34a97"],
        ["#b6ff5c61", "#7ab32f"],
        ["#e9f5ff4d", "#9fb3c4"],
      ],
      label: "#ffffff",
      shine: "#ffffff8c",
      radius: 8,
      stroke: "#ffffff66",
      ball: "#ffffff",
      glow: "#5cffc6",
      aim: "92, 255, 198",
      scene: "aurora",
      brick: "glass",
      orb: true,
    },
    effects: { burst: "stars", bounce: "ring", trail: true, clear: "rays" },
    ui: { accent: "#5cffc6", ink: "#e8fff8", surface: "#061826", font: "round", display: "serif" },
  },
  {
    id: "highroller",
    name: "High Roller",
    tagline: "Green baize, a gold rail and chips for bricks. The table everyone looks at twice.",
    price: { asset: "devnet", amount: 2_000_000_000 },
    board: {
      sky: ["#0f4a37", "#062218"],
      floor: "#041a12",
      line: "#d4af37",
      dots: null,
      bricks: [
        ["#c8102e", "#6e0817"],
        ["#1c1c1c", "#000000"],
        ["#1f4fd1", "#112d7a"],
        ["#0f8a4c", "#06522c"],
        ["#6b2fb3", "#3b1866"],
        ["#e9e2d0", "#9a937f"],
      ],
      label: "#f6e7b4",
      shine: null,
      radius: 12,
      stroke: "#d4af37",
      ball: "#fff3c4",
      glow: "#d4af37",
      aim: "212, 175, 55",
      scene: "felt",
      brick: "chip",
      orb: true,
    },
    effects: { burst: "coins", bounce: "ring", trail: false, clear: "jackpot" },
    ui: { accent: "#e4c25a", ink: "#f6efd9", surface: "#0a2a20", font: "serif", display: "serif" },
  },
];

export const DEFAULT_THEME: ThemeId = "classic";
export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
/** Every theme a player owns without buying it. */
export const isFreeTheme = (id: string) => THEMES.some((t) => t.id === id && t.price === null);
