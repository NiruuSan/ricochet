// Step-up authentication for irreversible actions. No imports, so it is easy to test.

/** How recently a user must have signed in with their provider to move money out. */
export const STEP_UP_WINDOW_MS = 15 * 60_000;

/**
 * Sending SOL off the site cannot be undone, so a session cookie alone is not
 * enough: the user must have signed in with their provider in the last few
 * minutes. A stolen or forgotten session cannot withdraw. Returns the error
 * response body, or null when the sign-in is recent.
 */
export function stepUpRequired(user: { userId: string; authTime: number | null }, now = Date.now()) {
  if (user.authTime !== null && now - user.authTime <= STEP_UP_WINDOW_MS && user.authTime <= now + 60_000) return null;
  return {
    error: "For your security, confirm it is you with your sign-in provider first.",
    code: "REAUTH_REQUIRED",
    provider: user.userId.split(":")[0],
  };
}
