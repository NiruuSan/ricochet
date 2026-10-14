// The skins a player can put on the game.
//
// A theme is data, never code: colours, a scene, a way of building bricks, a
// set of effects, a typeface and a voice. The board it describes is the same
// board — the bricks sit in the same cells, the balls bounce off the same edges
// (lib/engine.ts owns the geometry, and `brickBounds` never reads anything
// here). A theme cannot make a shot easier or harder, which is why it can be
// sold.
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
/** What a ball leaves behind as it flies: nothing, a few fading copies, or a comet's tail. */
export type Trail = "none" | "dots" | "comet";
/** The celebration when a board is cleared. */
export type Clear = "wash" | "rays" | "confetti" | "shockwave" | "fireworks" | "jackpot" | "petals" | "nova" | "warp";

/**
 * A picture behind the bricks, painted by app/arena/board-scenes.ts. Some move
 * (stars twinkle, snow falls, the aurora drifts); none of them is ever in front
 * of a brick or the ball, so nothing on the board is harder to read.
 */
export type Scene =
  | "skyline"
  | "papercraft"
  | "arcade"
  | "sea"
  | "rain"
  | "blossom"
  | "marble"
  | "flare"
  | "nebula"
  | "candy"
  | "snow"
  | "ink"
  | "outrun"
  | "cave"
  | "pulse"
  | "aurora"
  | "felt";
/** How a brick is built: flat paint, or something with depth. Same cell, same size, whichever. */
export type BrickStyle =
  | "flat"
  | "paper"
  | "pixel"
  | "pearl"
  | "crt"
  | "petal"
  | "metal"
  | "magma"
  | "glass"
  | "glossy"
  | "ink"
  | "neon"
  | "gem"
  | "gradient"
  | "chip";
/** How the game sounds in the theme. Every kit is synthesised by app/arena/sound-kits.ts. */
export type SoundKit =
  | "classic"
  | "synth"
  | "paper"
  | "chip"
  | "bubble"
  | "terminal"
  | "koto"
  | "gold"
  | "fire"
  | "space"
  | "candy"
  | "ice"
  | "zen"
  | "retro"
  | "crystal"
  | "chain"
  | "aurora"
  | "casino";

export type Theme = {
  id: ThemeId;
  name: string;
  /** One line, in the store. */
  tagline: string;
  /** Null for the theme everybody starts with. */
  price: { asset: "gems"; amount: number } | { asset: "devnet"; amount: number } | null;
  board: {
    /** Behind everything, top to bottom. */
    sky: [string, string];
    /** Below the launch line. */
    floor: string;
    line: string;
    /** The dotted grid, or null for a board with nothing behind the bricks. */
    dots: string | null;
    /** Face and shade for each brick colour, cycled per column and round. */
    bricks: [face: string, shade: string][];
    /**
     * The number on a brick, or "tone" for a deep shade of the brick's own
     * colour. Wherever it would not read, `labelAlt` is written instead (see
     * lib/colour.ts): a theme can be pretty, it cannot be illegible.
     */
    label: string;
    labelAlt: string;
    /** A dark outline round the number, at this opacity, for bricks too bright or too varied to trust one colour on. */
    outline?: number;
    /** The typeface of the numbers. */
    font: FontKey;
    /** A lighter band across the top of a brick, or null for a flat face. */
    shine: string | null;
    /** Corner radius in board units: 0 is a square brick, 7 is the classic one. */
    radius: number;
    /** An outline around each brick, for themes made of glass or light. */
    stroke: string | null;
    ball: string;
    glow: string;
    /** The aim guide, as `r, g, b` so the dots can fade along the line. */
    aim: string;
    /** A picture behind the bricks; none when absent. */
    scene?: Scene;
    /** How bricks are built; flat when absent. For "gradient" the shade is the second colour. */
    brick?: BrickStyle;
    /** A ball lit from one side, like a sphere, instead of a flat disc. */
    orb?: boolean;
  };
  effects: { burst: Burst; bounce: Bounce; trail: Trail; clear: Clear; sound: SoundKit };
  /** The screens around the board: accent, text, panels, and the typefaces. */
  ui: { accent: string; ink: string; surface: string; font: FontKey; display: FontKey };
};

/**
 * The catalogue. Eighteen looks that should never be mistaken for one another
 * at a glance — or by ear: from the free board to the gold-rimmed table, every
 * one has its own scene, its own bricks, its own break, bounce and clear, and
 * its own sound.
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
      labelAlt: "#ffffff",
      font: "system",
      shine: "#ffffff38",
      radius: 7,
      stroke: null,
      ball: "#ddffab",
      glow: "#c6f564",
      aim: "198, 245, 100",
    },
    effects: { burst: "shards", bounce: "none", trail: "none", clear: "wash", sound: "classic" },
    ui: { accent: "#c6f564", ink: "#e7edf7", surface: "#111826", font: "system", display: "system" },
  },
  {
    id: "neon",
    name: "Neon Grid",
    tagline: "A city at 3am: a skyline lit window by window, magenta, cyan, and a horizon that will not stop glowing.",
    price: { asset: "gems", amount: 2_500 },
    board: {
      sky: ["#12071f", "#2d0b45"],
      floor: "#0d0518",
      line: "#ff3df0",
      dots: "#4a2373",
      bricks: [
        ["#ff3df0", "#8c1c86"],
        ["#00f0ff", "#00808a"],
        ["#ffe600", "#8a7c00"],
        ["#8f74ff", "#47358f"],
        ["#ff6b9d", "#8a3a56"],
        ["#39ff88", "#1c8a49"],
      ],
      label: "#1a0b2e",
      labelAlt: "#ffffff",
      font: "orbitron",
      shine: "#ffffff66",
      radius: 0,
      stroke: "#ffffff38",
      ball: "#ffffff",
      glow: "#00f0ff",
      aim: "255, 61, 240",
      scene: "skyline",
    },
    effects: { burst: "sparks", bounce: "spark", trail: "dots", clear: "rays", sound: "synth" },
    ui: { accent: "#ff3df0", ink: "#f3e9ff", surface: "#1d0e33", font: "orbitron", display: "orbitron" },
  },
  {
    id: "paper",
    name: "Paper Cut",
    tagline: "Daylight, at last. Hills cut from card, bricks with a shadow under them, and scraps that fall when one tears.",
    price: { asset: "gems", amount: 4_000 },
    board: {
      sky: ["#f8f3e7", "#efe6d3"],
      floor: "#e6dbc4",
      line: "#b9ac91",
      dots: null,
      bricks: [
        ["#ef8b74", "#c4644f"],
        ["#62b59c", "#3f8a73"],
        ["#efc35e", "#c49a3a"],
        ["#7f9ed3", "#5876ab"],
        ["#d585b2", "#a85d89"],
        ["#93c26b", "#6a9547"],
      ],
      label: "#2e2618",
      labelAlt: "#fffaf0",
      font: "serif",
      shine: null,
      radius: 3,
      stroke: null,
      ball: "#2f2a20",
      glow: "#00000000",
      aim: "80, 72, 56",
      scene: "papercraft",
      brick: "paper",
    },
    effects: { burst: "scraps", bounce: "none", trail: "none", clear: "confetti", sound: "paper" },
    ui: { accent: "#d0553f", ink: "#2f2a20", surface: "#fbf7ee", font: "serif", display: "serif" },
  },
  {
    id: "arcade",
    name: "Arcade 84",
    tagline: "Eight-bit bricks, a starfield scrolling past and a screen that hums. Bring coins.",
    price: { asset: "gems", amount: 6_000 },
    board: {
      sky: ["#05050a", "#0d0d16"],
      floor: "#030305",
      line: "#f8f8f8",
      dots: null,
      bricks: [
        ["#ff2457", "#a3002b"],
        ["#ffcc00", "#a38200"],
        ["#00d1ff", "#0085a3"],
        ["#00ff66", "#00a341"],
        ["#ff8a1f", "#a34e00"],
        ["#f4f4f4", "#9a9a9a"],
      ],
      label: "#0b0b0b",
      labelAlt: "#ffffff",
      font: "pixel",
      shine: null,
      radius: 0,
      stroke: null,
      ball: "#ffffff",
      glow: "#ffcc00",
      aim: "255, 204, 0",
      scene: "arcade",
      brick: "pixel",
    },
    effects: { burst: "pixels", bounce: "none", trail: "none", clear: "shockwave", sound: "chip" },
    ui: { accent: "#ffcc00", ink: "#f8f8f8", surface: "#121218", font: "system", display: "pixel" },
  },
  {
    id: "deep",
    name: "Deep Sea",
    tagline: "Far under. Light falling through the water, pearl bricks, and bubbles on the way up.",
    price: { asset: "gems", amount: 8_000 },
    board: {
      sky: ["#04384a", "#03121c"],
      floor: "#021a24",
      line: "#2a8ea0",
      dots: null,
      bricks: [
        ["#5fd3a1", "#2f7d5c"],
        ["#45b3b5", "#1f6567"],
        ["#8af0a3", "#4a9159"],
        ["#cdf9d1", "#77a87b"],
        ["#6db3dc", "#2f6a8f"],
        ["#f6a96b", "#96602f"],
      ],
      label: "#03141f",
      labelAlt: "#e0fbfc",
      font: "round",
      shine: null,
      radius: 14,
      stroke: null,
      ball: "#e0fbfc",
      glow: "#5fd3a1",
      aim: "138, 240, 163",
      scene: "sea",
      brick: "pearl",
      orb: true,
    },
    effects: { burst: "bubbles", bounce: "ripple", trail: "dots", clear: "wash", sound: "bubble" },
    ui: { accent: "#5fd3a1", ink: "#e0fbfc", surface: "#06283a", font: "round", display: "round" },
  },
  {
    id: "terminal",
    name: "Terminal",
    tagline: "Green phosphor, code raining behind the bricks, and characters falling out of every one you crack.",
    price: { asset: "gems", amount: 12_000 },
    board: {
      sky: ["#000a03", "#001407"],
      floor: "#000802",
      line: "#00ff6a",
      dots: null,
      bricks: [
        ["#00ff6a", "#008035"],
        ["#00d65a", "#00642a"],
        ["#a6ff1a", "#4e8000"],
        ["#00ffa3", "#008052"],
        ["#70ffa0", "#33804d"],
        ["#19ee7f", "#007338"],
      ],
      label: "#001a08",
      labelAlt: "#d4ffe4",
      font: "mono",
      shine: null,
      radius: 0,
      stroke: null,
      ball: "#d4ffe4",
      glow: "#00ff6a",
      aim: "0, 255, 106",
      scene: "rain",
      brick: "crt",
    },
    effects: { burst: "glyphs", bounce: "none", trail: "none", clear: "rays", sound: "terminal" },
    ui: { accent: "#00ff6a", ink: "#c8ffdd", surface: "#001208", font: "mono", display: "mono" },
  },
  {
    id: "sakura",
    name: "Sakura",
    tagline: "Dusk under the blossom: a pale moon, a branch in flower, and petals drifting down through every shot.",
    price: { asset: "gems", amount: 20_000 },
    board: {
      sky: ["#24172e", "#5a2a4a"],
      floor: "#1e1322",
      line: "#e8a0bf",
      dots: null,
      bricks: [
        ["#ffb3c6", "#b56f84"],
        ["#ffcfe1", "#b58599"],
        ["#d6bfe6", "#8b7799"],
        ["#c4e3fe", "#7a92a8"],
        ["#ffa8c7", "#b06e8b"],
        ["#f9dbe4", "#a68f97"],
      ],
      label: "#3a1f33",
      labelAlt: "#fff0f6",
      font: "round",
      shine: null,
      radius: 12,
      stroke: null,
      ball: "#fff0f6",
      glow: "#ffb3c6",
      aim: "255, 179, 198",
      scene: "blossom",
      brick: "petal",
      orb: true,
    },
    effects: { burst: "petals", bounce: "none", trail: "dots", clear: "petals", sound: "koto" },
    ui: { accent: "#ffb3c6", ink: "#fff0f6", surface: "#2c1c30", font: "round", display: "serif" },
  },
  {
    id: "obsidian",
    name: "Obsidian & Gold",
    tagline: "Black marble veined with gold, bricks of beaten gold leaf, and dust that hangs in the air after a break.",
    price: { asset: "devnet", amount: 250_000_000 },
    board: {
      sky: ["#0b0b0e", "#16161c"],
      floor: "#070709",
      line: "#c9a227",
      dots: null,
      bricks: [
        ["#ecc96a", "#8f7322"],
        ["#d4ad3a", "#7d6416"],
        ["#f3e3b6", "#a1936f"],
        ["#b39a6b", "#6b5a3a"],
        ["#e0bb4a", "#856d1f"],
        ["#f0e2c2", "#9c9079"],
      ],
      label: "#0a0a0c",
      labelAlt: "#f6e7b4",
      font: "serif",
      shine: null,
      radius: 1,
      stroke: "#fff3c8",
      ball: "#fff3c8",
      glow: "#c9a227",
      aim: "201, 162, 39",
      scene: "marble",
      brick: "metal",
      orb: true,
    },
    effects: { burst: "dust", bounce: "ring", trail: "none", clear: "rays", sound: "gold" },
    ui: { accent: "#d4ad3a", ink: "#f2e9d2", surface: "#111116", font: "serif", display: "serif" },
  },
  {
    id: "solar",
    name: "Solar Flare",
    tagline: "Something molten. The sun's own edge above the board, bricks with a burning core, and a comet for a ball.",
    price: { asset: "devnet", amount: 500_000_000 },
    board: {
      sky: ["#2a0c04", "#120402"],
      floor: "#0e0402",
      line: "#ff7b29",
      dots: null,
      bricks: [
        ["#ffd166", "#a6602f"],
        ["#ffa22a", "#a6460f"],
        ["#ff7140", "#a6301c"],
        ["#ff5a52", "#a11a28"],
        ["#ffc36e", "#a6603c"],
        ["#fff1a8", "#a67c47"],
      ],
      label: "#1a0a05",
      labelAlt: "#ffe9d0",
      font: "orbitron",
      shine: null,
      radius: 5,
      stroke: null,
      ball: "#fff6e0",
      glow: "#ff7b29",
      aim: "255, 140, 60",
      scene: "flare",
      brick: "magma",
      orb: true,
    },
    effects: { burst: "embers", bounce: "spark", trail: "comet", clear: "nova", sound: "fire" },
    ui: { accent: "#ff7b29", ink: "#ffe9d0", surface: "#23100a", font: "orbitron", display: "orbitron" },
  },
  {
    id: "void",
    name: "Void",
    tagline: "Deep space: a nebula, a shooting star now and then, bricks of real glass and a comet where the ball used to be.",
    price: { asset: "devnet", amount: 1_000_000_000 },
    board: {
      sky: ["#04030c", "#0c0a24"],
      floor: "#03020a",
      line: "#7c6cf0",
      dots: null,
      bricks: [
        ["#9a8bff85", "#6c5ce7"],
        ["#55a8ff85", "#0984e3"],
        ["#3fe3e07a", "#00cec9"],
        ["#ff5fa585", "#e84393"],
        ["#ffcf6b70", "#fdcb6e"],
        ["#c9d4ff6b", "#8e9bd6"],
      ],
      label: "#ffffff",
      labelAlt: "#0b0a1c",
      font: "orbitron",
      shine: "#ffffff70",
      radius: 3,
      stroke: "#ffffff8c",
      ball: "#ffffff",
      glow: "#a29bfe",
      aim: "162, 155, 254",
      scene: "nebula",
      brick: "glass",
      orb: true,
    },
    effects: { burst: "shards", bounce: "ring", trail: "comet", clear: "warp", sound: "space" },
    ui: { accent: "#a29bfe", ink: "#eef0ff", surface: "#0b0a1c", font: "orbitron", display: "orbitron" },
  },
  {
    id: "candy",
    name: "Candy Pop",
    tagline: "Jelly bricks, a sugar-pink sky and sprinkles everywhere a brick gives way.",
    price: { asset: "gems", amount: 5_000 },
    board: {
      sky: ["#ffe4f2", "#d9f0ff"],
      floor: "#ffd3ea",
      line: "#ff8fc4",
      dots: null,
      bricks: [
        ["#ff6fae", "#d1407f"],
        ["#ffb347", "#d9822b"],
        ["#5fdcff", "#2ba6cf"],
        ["#b896ff", "#7f5ad6"],
        ["#6ff09a", "#36b864"],
        ["#ffdc5e", "#d4ac2c"],
      ],
      label: "tone",
      labelAlt: "#ffffff",
      font: "round",
      shine: null,
      radius: 18,
      stroke: null,
      ball: "#e0157a",
      glow: "#ff6fae",
      aim: "224, 21, 122",
      scene: "candy",
      brick: "glossy",
      orb: true,
    },
    effects: { burst: "sprinkles", bounce: "ring", trail: "none", clear: "confetti", sound: "candy" },
    ui: { accent: "#e8247c", ink: "#3d1730", surface: "#fff4fa", font: "round", display: "round" },
  },
  {
    id: "frost",
    name: "Frostbite",
    tagline: "A winter night. Bricks of frosted ice, snow that never stops, and crystals when one shatters.",
    price: { asset: "gems", amount: 9_000 },
    board: {
      sky: ["#051327", "#16416a"],
      floor: "#0a1f37",
      line: "#9ad8ff",
      dots: null,
      bricks: [
        ["#c4ecffc7", "#5d9fd0"],
        ["#a3d8ffc7", "#4d86c4"],
        ["#d5e0ffc7", "#7085cf"],
        ["#b3f2ffc7", "#4aa9c2"],
        ["#e6f6ffc7", "#86a9c9"],
        ["#9fcff7c7", "#4a7fb8"],
      ],
      label: "#0b2140",
      labelAlt: "#ffffff",
      font: "round",
      shine: "#ffffffd0",
      radius: 6,
      stroke: "#f2fbffe6",
      ball: "#ffffff",
      glow: "#9ad8ff",
      aim: "180, 225, 255",
      scene: "snow",
      brick: "glass",
      orb: true,
    },
    effects: { burst: "crystals", bounce: "ring", trail: "dots", clear: "shockwave", sound: "ice" },
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
      labelAlt: "#1f1c1a",
      font: "serif",
      shine: null,
      radius: 2,
      stroke: null,
      ball: "#b8312f",
      glow: "#00000000",
      aim: "70, 56, 44",
      scene: "ink",
      brick: "ink",
    },
    effects: { burst: "ink", bounce: "none", trail: "none", clear: "wash", sound: "zen" },
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
      labelAlt: "#ffffff",
      font: "orbitron",
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
    effects: { burst: "sparks", bounce: "spark", trail: "comet", clear: "fireworks", sound: "retro" },
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
      labelAlt: "#1a0b2e",
      outline: 0.55,
      font: "serif",
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
    effects: { burst: "crystals", bounce: "spark", trail: "dots", clear: "fireworks", sound: "crystal" },
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
      labelAlt: "#ffffff",
      outline: 0.6,
      font: "orbitron",
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
    effects: { burst: "pixels", bounce: "ring", trail: "dots", clear: "shockwave", sound: "chain" },
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
      labelAlt: "#ffffff",
      outline: 0.35,
      font: "round",
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
    effects: { burst: "stars", bounce: "ring", trail: "dots", clear: "rays", sound: "aurora" },
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
      labelAlt: "#1c1c1c",
      font: "serif",
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
    effects: { burst: "coins", bounce: "ring", trail: "none", clear: "jackpot", sound: "casino" },
    ui: { accent: "#e4c25a", ink: "#f6efd9", surface: "#0a2a20", font: "serif", display: "serif" },
  },
];

export const DEFAULT_THEME: ThemeId = "classic";
export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
/** Every theme a player owns without buying it. */
export const isFreeTheme = (id: string) => THEMES.some((t) => t.id === id && t.price === null);
