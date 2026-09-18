import Arena from "../../../arena/arena";

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <Arena view="admin" adminCaseName={name} />;
}
