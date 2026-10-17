import { adminReader } from "@/lib/admin-guard";
import { json } from "@/lib/http";
import { surveyResults } from "@/lib/survey";

export const dynamic = "force-dynamic";

/** The beta survey's scores and comments, with names. */
export async function GET() {
  const { locked } = await adminReader();
  if (locked) return locked;
  try {
    return json(await surveyResults());
  } catch (e) {
    console.error(e);
    return json({ error: "The survey results are unavailable right now." }, 503);
  }
}
