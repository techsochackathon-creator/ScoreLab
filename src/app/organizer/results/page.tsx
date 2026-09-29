import { prisma } from "@/lib/prisma";
import { getJudgeResults } from "@/lib/judgeResults";
import { finalizationBlockers, getOfficialState, judgingProgress } from "@/lib/officialResults";
import { JudgeResultsView } from "@/components/JudgeResultsView";
import { FinalResultsView } from "@/components/FinalResultsView";

export const dynamic = "force-dynamic";

/**
 * Organizer-only (middleware + organizer layout).
 * Finalized → the frozen snapshot. Judging open → live results + finalization readiness.
 */
export default async function ResultsPage() {
  const state = await getOfficialState(prisma);
  if (state) return <FinalResultsView state={state} />;

  const results = await getJudgeResults(prisma);
  return <JudgeResultsView results={results} blockers={finalizationBlockers(results)} progress={judgingProgress(results)} />;
}
