import { getOrCreateRubric } from "@/lib/rubric";
import { prisma } from "@/lib/prisma";
import { isRubricLocked } from "@/lib/judges";
import { parseAnchors } from "@/lib/scoring";
import { RubricEditor, type CriterionDraft } from "@/components/RubricEditor";

export const dynamic = "force-dynamic";

export default async function RubricPage() {
  const [rubric, locked] = await Promise.all([getOrCreateRubric(), isRubricLocked(prisma)]);
  const criteria: CriterionDraft[] = rubric.criteria.map((c) => ({
    name: c.name,
    description: c.description,
    weight: c.weight,
    scaleMax: c.scaleMax,
    anchors: parseAnchors(c.anchors, c.scaleMax),
  }));
  return <RubricEditor initialName={rubric.name} initialCriteria={criteria} locked={locked} />;
}
