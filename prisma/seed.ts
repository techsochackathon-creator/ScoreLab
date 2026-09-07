import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// AI Hackathon 2026 — Official Judge Evaluation Rubric (from PDF)
// ---------------------------------------------------------------------------

const CRITERIA = [
  {
    name: "Problem & Innovation",
    description:
      "Problem relevance, originality, creativity, and quality of the proposed solution.",
    weight: 20,
    scaleMax: 20,
    anchors: [
      { score: 1, label: "Weak (0–8): Problem is unclear, solution is mostly generic, or little innovation is demonstrated." },
      { score: 5, label: "Fair (9–12): Reasonable problem and solution, but limited novelty or differentiation." },
      { score: 10, label: "Good (13–16): Relevant problem with noticeable originality and a well-developed solution." },
      { score: 15, label: "Excellent (17–20): Clearly defined, meaningful problem with a highly original or creative approach." },
      { score: 20, label: "Perfect: Exceptional problem framing with groundbreaking innovation." },
    ],
  },
  {
    name: "AI Implementation",
    description:
      "Meaningful use of AI, technical depth, appropriate model/tool selection, and integration.",
    weight: 25,
    scaleMax: 25,
    anchors: [
      { score: 1, label: "Weak (0–9): AI use is superficial, unnecessary, poorly integrated, or not convincingly demonstrated." },
      { score: 7, label: "Fair (10–15): AI is present but contributes limited value or integration is basic." },
      { score: 13, label: "Good (16–20): AI is meaningfully used with solid integration and reasonable technical depth." },
      { score: 19, label: "Excellent (21–25): AI is central to the solution, technically well integrated, appropriately selected, and demonstrates strong understanding." },
      { score: 25, label: "Perfect: AI implementation is exceptional, innovative, and technically masterful." },
    ],
  },
  {
    name: "Functionality & Technical Execution",
    description:
      "Working features, reliability, integration, code/architecture quality, and technical completeness.",
    weight: 20,
    scaleMax: 20,
    anchors: [
      { score: 1, label: "Weak (0–8): Major features are incomplete, broken, or insufficiently demonstrated." },
      { score: 5, label: "Fair (9–12): Basic functionality works but important limitations or bugs remain." },
      { score: 10, label: "Good (13–16): Most important features work with minor issues." },
      { score: 15, label: "Excellent (17–20): Core features work reliably; strong implementation, integration, and technical execution." },
      { score: 20, label: "Perfect: Flawless execution with exceptional technical quality." },
    ],
  },
  {
    name: "Impact & Practicality",
    description:
      "Real-world usefulness, target users, scalability, feasibility, and potential impact.",
    weight: 15,
    scaleMax: 15,
    anchors: [
      { score: 1, label: "Weak (0–6): Limited practical value or unrealistic application." },
      { score: 4, label: "Fair (7–9): Some potential impact, but feasibility or user value is unclear." },
      { score: 8, label: "Good (10–12): Useful and practical with a credible path to real-world use." },
      { score: 12, label: "Excellent (13–15): Strong real-world value, clear users, feasible adoption, and convincing scalability/impact." },
      { score: 15, label: "Perfect: Transformative real-world impact with clear adoption path." },
    ],
  },
  {
    name: "UX/Design",
    description:
      "Usability, interface clarity, accessibility, user flow, and overall experience.",
    weight: 10,
    scaleMax: 10,
    anchors: [
      { score: 1, label: "Weak (0–4): Difficult to use or poorly designed." },
      { score: 3, label: "Fair (5–6): Usable but inconsistent, cluttered, or underdeveloped." },
      { score: 5, label: "Good (7–8): Clear and usable with minor design issues." },
      { score: 8, label: "Excellent (9–10): Intuitive, polished, accessible, and well-designed user experience." },
      { score: 10, label: "Perfect: Exceptional UX that delights users." },
    ],
  },
  {
    name: "Presentation & Demo",
    description:
      "Clarity of explanation, quality of live demo, communication, and ability to answer questions.",
    weight: 10,
    scaleMax: 10,
    anchors: [
      { score: 1, label: "Weak (0–4): Unclear presentation, weak demonstration, or unable to explain the project." },
      { score: 3, label: "Fair (5–6): Understandable but lacks clarity, structure, or demo quality." },
      { score: 5, label: "Good (7–8): Well explained and demonstrated with minor communication issues." },
      { score: 8, label: "Excellent (9–10): Clear, concise, compelling presentation with a strong live demo and confident answers." },
      { score: 10, label: "Perfect: Outstanding presentation that captivates the audience." },
    ],
  },
];

async function main() {
  // Organizer login — techsoc hackathon account.
  const passwordHash = await bcrypt.hash("organizer123", 10);

  // Update existing organizer@example.com → new email, or create fresh.
  const existingUser = await prisma.user.findUnique({ where: { email: "organizer@example.com" } });
  if (existingUser) {
    await prisma.user.update({
      where: { email: "organizer@example.com" },
      data: { email: "techsoc.hackathon@gmail.com", name: "TechSoc Hackathon" },
    });
  }

  await prisma.user.upsert({
    where: { email: "techsoc.hackathon@gmail.com" },
    update: {},
    create: { email: "techsoc.hackathon@gmail.com", name: "TechSoc Hackathon", passwordHash, role: "ORGANIZER" },
  });

  // Rubric: delete old default and create the official AI Hackathon 2026 rubric.
  const existing = await prisma.rubric.findFirst();
  if (existing) {
    // Delete old criteria and rubric to replace with official one.
    await prisma.criterionScore.deleteMany({});
    await prisma.criterion.deleteMany({});
    await prisma.rubric.deleteMany({});
  }

  await prisma.rubric.create({
    data: {
      name: "AI Hackathon 2026 — Official Judge Evaluation Rubric",
      criteria: {
        create: CRITERIA.map((c, i) => ({
          name: c.name,
          description: c.description,
          weight: c.weight,
          scaleMax: c.scaleMax,
          anchors: c.anchors,
          order: i,
        })),
      },
    },
  });

  // Demo teams.
  const teams = [
    { teamCode: "T01", name: "Rockets", university: "State University", track: "Web", memberNames: ["Ada Lovelace", "Alan Turing"] },
    { teamCode: "T02", name: "Neon Owls", university: "Tech Institute", track: "Web", memberNames: ["Grace Hopper"] },
    { teamCode: "T03", name: "DeepThinkers", university: "State University", track: "AI/ML", memberNames: ["Geoffrey H.", "Yoshua B."] },
  ];
  for (const t of teams) {
    await prisma.team.upsert({ where: { teamCode: t.teamCode }, update: {}, create: t });
  }

  console.log("Seeded AI Hackathon 2026 rubric.");
  console.log("Organizer login: techsoc.hackathon@gmail.com / organizer123");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
