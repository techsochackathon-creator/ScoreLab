import { prisma } from "@/lib/prisma";
import { getJudgeResults } from "@/lib/judgeResults";
import { getPublication } from "@/lib/officialResults";
import { JudgeResultsView } from "@/components/JudgeResultsView";

export const dynamic = "force-dynamic";

/** Organizer-only (middleware + organizer layout): official judge-score results. */
export default async function ResultsPage() {
  const [results, publication] = await Promise.all([getJudgeResults(prisma), getPublication(prisma)]);
  return <JudgeResultsView results={results} publishedAt={publication?.publishedAt.toISOString() ?? null} />;
}
