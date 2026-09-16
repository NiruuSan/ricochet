import { auth } from "@/auth";
import { adminId } from "@/db/raw";

export { STEP_UP_WINDOW_MS, stepUpRequired } from "./step-up";

export type SignedInUser = {
  userId: string;
  displayName: string;
  /** When the user last signed in with their provider, or null for sessions issued before this was recorded. */
  authTime: number | null;
};

/** The signed-in player, or null. User IDs look like `github:12345`. */
export async function currentUser(): Promise<SignedInUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const authTime = (session as { authTime?: unknown }).authTime;
  return { userId, displayName: session.user?.name ?? session.user?.email ?? userId, authTime: typeof authTime === "number" ? authTime : null };
}

/** The signed-in user if they are the configured administrator, or null. */
export async function administrator() {
  const user = await currentUser();
  const admin = adminId();
  return user && admin && user.userId === admin ? user : null;
}
