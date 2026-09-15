import { auth } from "@/auth";

export type SignedInUser = { userId: string; displayName: string };

/** The signed-in player, or null. User IDs look like `github:12345`. */
export async function currentUser(): Promise<SignedInUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return { userId, displayName: session.user?.name ?? session.user?.email ?? userId };
}
