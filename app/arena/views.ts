// Shared with the server page, so it must not live in a "use client" module:
// server code importing a value from one receives a client reference instead.
export const VIEWS = ["play", "welcome", "matches", "live", "leaderboard", "wallet", "login", "signup", "faq", "rules", "admin", "profile", "tournaments", "watch"] as const;
export type View = (typeof VIEWS)[number];
