import { getOrCreateRubric } from "@/lib/rubric";
import { parseAnchors } from "@/lib/scoring";
import { RubricEditor, type CriterionDraft } from "@/components/RubricEditor";

export const dynamic = "force-dynamic";

export default async function RubricPage() {
  const rubric = await getOrCreateRubric();
  const criteria: CriterionDraft[] = rubric.criteria.map((c) => ({
    name: c.name,
    description: c.description,
    weight: c.weight,
    scaleMax: c.scaleMax,
    anchors: parseAnchors(c.anchors, c.scaleMax),
  }));
  return <RubricEditor initialName={rubric.name} initialCriteria={criteria} />;
}
