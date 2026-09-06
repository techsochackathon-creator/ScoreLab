import { prisma } from "@/lib/prisma";

/** Default anchored rubric seeded when none exists (5 criteria, weight 20 each). */
export const DEFAULT_RUBRIC = {
  name: "Default Rubric",
  criteria: [
    {
      name: "Code Quality",
      description:
        "Readability, consistency, naming, structure of the code; absence of obvious smells.",
      weight: 20,
    },
    {
      name: "Documentation",
      description:
        "README clarity, setup instructions, inline comments, and overall explanation of the project.",
      weight: 20,
    },
    {
      name: "Functionality / Completeness",
      description:
        "How complete and working the project appears based on the evidence; are the core features implemented?",
      weight: 20,
    },
    {
      name: "Technical Complexity",
      description:
        "Ambition and sophistication of the technical approach relative to a hackathon timeframe.",
      weight: 20,
    },
    {
      name: "Project Structure",
      description:
        "Sensible file/folder organization, separation of concerns, and maintainability.",
      weight: 20,
    },
  ],
} as const;

const DEFAULT_ANCHORS = [
  { score: 1, label: "Poor — largely missing or seriously deficient." },
  { score: 2, label: "Below average — present but weak, with notable gaps." },
  { score: 3, label: "Adequate — meets basic expectations." },
  { score: 4, label: "Strong — clearly above average and well executed." },
  { score: 5, label: "Excellent — exemplary, best-in-class for a hackathon." },
];

/** Get the single rubric with ordered criteria, creating the default if absent. */
export async function getOrCreateRubric() {
  let rubric = await prisma.rubric.findFirst({
    include: { criteria: { orderBy: { order: "asc" } } },
  });
  if (rubric) return rubric;

  rubric = await prisma.rubric.create({
    data: {
      name: DEFAULT_RUBRIC.name,
      criteria: {
        create: DEFAULT_RUBRIC.criteria.map((c, i) => ({
          name: c.name,
          description: c.description,
          weight: c.weight,
          scaleMax: 5,
          anchors: DEFAULT_ANCHORS,
          order: i,
        })),
      },
    },
    include: { criteria: { orderBy: { order: "asc" } } },
  });
  return rubric;
}

export { DEFAULT_ANCHORS };
