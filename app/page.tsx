import Arena from "./arena/arena";

export default async function Home({ searchParams }: { searchParams: Promise<{ match?: string | string[]; tournament?: string | string[]; join?: string | string[] }> }) {
  const { match, tournament, join } = await searchParams;
  // `/?match=<id>` opens that match's end-of-run screen, for example from a notification.
  // `/?tournament=<id>` starts or resumes that tournament run.
  // `/?join=<code>` takes the seat of a challenge someone sent.
  return (
    <Arena
      view="play"
      initialMatchId={typeof match === "string" ? match : undefined}
      initialTournamentId={typeof tournament === "string" ? tournament : undefined}
      initialInvite={typeof join === "string" ? join : undefined}
    />
  );
}
