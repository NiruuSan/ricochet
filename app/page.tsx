import Arena from "./arena/arena";

export default async function Home({ searchParams }: { searchParams: Promise<{ match?: string | string[]; tournament?: string | string[] }> }) {
  const { match, tournament } = await searchParams;
  // `/?match=<id>` opens that match's end-of-run screen, for example from a notification.
  // `/?tournament=<id>` starts or resumes that tournament run.
  return (
    <Arena view="play" initialMatchId={typeof match === "string" ? match : undefined} initialTournamentId={typeof tournament === "string" ? tournament : undefined} />
  );
}
