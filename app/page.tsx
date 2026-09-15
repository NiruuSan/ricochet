import Arena from "./arena/arena";

export default async function Home({ searchParams }: { searchParams: Promise<{ match?: string | string[] }> }) {
  const { match } = await searchParams;
  // `/?match=<id>` opens that match's end-of-run screen, for example from a notification.
  return <Arena view="play" initialMatchId={typeof match === "string" ? match : undefined} />;
}
