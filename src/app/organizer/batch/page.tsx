import { prisma } from "@/lib/prisma";
import { BatchPanel } from "@/components/BatchPanel";

export const dynamic = "force-dynamic";

export default async function BatchPage() {
  const teamCount = await prisma.team.count({
    where: { repoUrl: { not: null } },
  });

  return <BatchPanel teamCount={teamCount} />;
}
