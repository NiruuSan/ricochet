import { currentUser, stepUpRequired } from "@/lib/auth-user";
import { deleteAccount, exportAccount } from "@/lib/account";
import { json, readBody, sameOrigin } from "@/lib/http";
import { avatarUrl, GameError } from "@/lib/matches";
import { removeAvatar, renamePlayer, setAvatar } from "@/lib/profile";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to edit your profile." }, 401);
    if (await rateLimited("profileWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    // A resized picture is at most 100 kB, about 135 kB once base64-encoded.
    const parsed = await readBody(req, 150_000);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    switch (b.action) {
      case "rename":
        return json({ name: await renamePlayer(user.userId, b.name) });
      case "avatar":
        return json({ avatar: avatarUrl(await setAvatar(user.userId, b.image)) });
      case "remove_avatar":
        await removeAvatar(user.userId);
        return json({ avatar: null });
      case "export":
        return json(await exportAccount(user.userId));
      case "delete": {
        // Closing an account cannot be undone, so the provider has to vouch for
        // whoever is asking, exactly like a change to two-factor authentication.
        const stepUp = stepUpRequired(user);
        if (stepUp) return json({ ...stepUp, error: "For your security, confirm it is you with your sign-in provider before deleting your account." }, 403);
        return json(await deleteAccount(user.userId));
      }
      default:
        return json({ error: "Unknown profile action." }, 400);
    }
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your profile could not be saved. Please try again." }, 503);
  }
}
