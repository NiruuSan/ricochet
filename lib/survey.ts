import { database } from "@/db/raw";

// The beta survey: two questions, asked once, after a player's fifth finished
// game — late enough that they know the game, early enough that what put them
// off is still fresh. How likely they are to recommend Bounce (0 to 10, the
// net promoter question), and one thing to fix or add, in their own words.
//
// The answer is the player's own: it goes in their data export and goes with
// their account. The administrator reads the scores and the words, with names,
// in the admin (app/arena/views/admin-feedback.tsx).

import { ANSWER_MAX, SURVEY } from "./survey-limits";

export { ANSWER_MAX, SURVEY };

export class SurveyError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Games a player has finished: their runs in 1v1 matches and in tournaments. */
async function gamesPlayed(uid: string) {
  const row = await database()
    .prepare("SELECT (SELECT COUNT(*) FROM runs WHERE user_id = ? AND done = 1) + (SELECT COUNT(*) FROM tournament_entries WHERE user_id = ? AND done = 1) AS n")
    .bind(uid, uid)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** The survey to show this player now, or null: answered already, or too few games yet. */
export async function surveyDue(uid: string): Promise<{ id: string } | null> {
  const answered = await database().prepare("SELECT 1 AS yes FROM survey_responses WHERE user_id = ? AND survey = ?").bind(uid, SURVEY.id).first<{ yes: number }>();
  if (answered) return null;
  return (await gamesPlayed(uid)) >= SURVEY.after ? { id: SURVEY.id } : null;
}

/** Keeps a player's answer, once. */
export async function submitSurvey(uid: string, input: { survey?: unknown; score?: unknown; answer?: unknown }, now = Date.now()) {
  if (input.survey !== SURVEY.id) throw new SurveyError("This survey is closed.", 404);
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new SurveyError("Pick a score from 0 to 10.");
  const answer = typeof input.answer === "string" ? input.answer.replace(/\r\n/g, "\n").trim() : "";
  if (answer.length > ANSWER_MAX) throw new SurveyError(`Keep it under ${ANSWER_MAX.toLocaleString("en")} characters.`);
  const games = await gamesPlayed(uid);
  if (games < SURVEY.after) throw new SurveyError(`Play ${SURVEY.after} games first.`, 409);
  const saved = await database()
    .prepare("INSERT OR IGNORE INTO survey_responses(user_id, survey, score, answer, games, created) VALUES(?, ?, ?, ?, ?, ?)")
    .bind(uid, SURVEY.id, score, answer || null, games, now)
    .run();
  if (!saved.meta.changes) throw new SurveyError("You have already answered. Thank you!", 409);
  return { saved: true as const };
}

export type SurveyResults = {
  survey: string;
  responses: number;
  /** Players past the fifth game, answered or not: how many could have. */
  eligible: number;
  /** Promoters (9–10) minus detractors (0–6), as a share of answers: -100 to 100. */
  nps: number | null;
  average: number | null;
  /** How many answered each score, 0 to 10. */
  scores: number[];
  comments: { name: string; score: number; answer: string; games: number; created: number }[];
};

/** For the administrator: the scores, and every comment with who wrote it, newest first. */
export async function surveyResults(limit = 200): Promise<SurveyResults> {
  const db = database();
  const [rows, comments, eligible] = await Promise.all([
    db.prepare("SELECT score, COUNT(*) AS n FROM survey_responses WHERE survey = ? GROUP BY score").bind(SURVEY.id).all<{ score: number; n: number }>(),
    db
      .prepare(
        `SELECT p.name, s.score, s.answer, s.games, s.created FROM survey_responses s JOIN players p ON p.id = s.user_id
         WHERE s.survey = ? AND s.answer IS NOT NULL AND p.deleted IS NULL ORDER BY s.created DESC LIMIT ?`,
      )
      .bind(SURVEY.id, limit)
      .all<{ name: string; score: number; answer: string; games: number; created: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM players p WHERE p.bot = 0 AND p.deleted IS NULL
           AND (SELECT COUNT(*) FROM runs r WHERE r.user_id = p.id AND r.done = 1) + (SELECT COUNT(*) FROM tournament_entries e WHERE e.user_id = p.id AND e.done = 1) >= ?`,
      )
      .bind(SURVEY.after)
      .first<{ n: number }>(),
  ]);
  const scores = Array.from({ length: 11 }, () => 0);
  for (const row of rows.results) if (row.score >= 0 && row.score <= 10) scores[row.score] = Number(row.n);
  const responses = scores.reduce((a, b) => a + b, 0);
  const promoters = scores[9] + scores[10];
  const detractors = scores.slice(0, 7).reduce((a, b) => a + b, 0);
  return {
    survey: SURVEY.id,
    responses,
    eligible: Number(eligible?.n ?? 0),
    nps: responses ? Math.round(((promoters - detractors) / responses) * 100) : null,
    average: responses ? Math.round((scores.reduce((sum, n, score) => sum + n * score, 0) / responses) * 10) / 10 : null,
    scores,
    comments: comments.results,
  };
}
