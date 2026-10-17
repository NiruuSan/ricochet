// The beta survey's settings, shared by the server (lib/survey.ts) and the card
// in the arena, which must not pull the database into the browser.

/** Which survey is open, and after how many finished games it is asked. */
export const SURVEY = { id: "beta-1", after: 5 } as const;
/** The most a player can write. */
export const ANSWER_MAX = 1000;
