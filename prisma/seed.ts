import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ANCHORS = [
  { score: 1, label: "Poor — largely missing or seriously deficient." },
  { score: 2, label: "Below average — present but weak, with notable gaps." },
  { score: 3, label: "Adequate — meets basic expectations." },
  { score: 4, label: "Strong — clearly above average and well executed." },
  { score: 5, label: "Excellent — exemplary, best-in-class for a hackathon." },
];

const CRITERIA = [
  { name: "Code Quality", description: "Readability, consistency, naming, structure of the code; absence of obvious smells.", weight: 20 },
  { name: "Documentation", description: "README clarity, setup instructions, inline comments, and overall explanation of the project.", weight: 20 },
  { name: "Functionality / Completeness", description: "How complete and working the project appears based on the evidence; are the core features implemented?", weight: 20 },
  { name: "Technical Complexity", description: "Ambition and sophistication of the technical approach relative to a hackathon timeframe.", weight: 20 },
  { name: "Project Structure", description: "Sensible file/folder organization, separation of concerns, and maintainability.", weight: 20 },
];

async function main() {
  // Organizer login.
  const passwordHash = await bcrypt.hash("organizer123", 10);
  await prisma.user.upsert({
    where: { email: "organizer@example.com" },
    update: {},
    create: { email: "organizer@example.com", name: "Lead Organizer", passwordHash, role: "ORGANIZER" },
  });

  // Default rubric (only if none exists).
  const existing = await prisma.rubric.findFirst();
  if (!existing) {
    await prisma.rubric.create({
      data: {
        name: "Default Rubric",
        criteria: {
          create: CRITERIA.map((c, i) => ({
            name: c.name,
            description: c.description,
            weight: c.weight,
            scaleMax: 5,
            anchors: ANCHORS,
            order: i,
          })),
        },
      },
    });
  }

  // Demo teams.
  const teams = [
    { teamCode: "T01", name: "Rockets", university: "State University", track: "Web", memberNames: ["Ada Lovelace", "Alan Turing"] },
    { teamCode: "T02", name: "Neon Owls", university: "Tech Institute", track: "Web", memberNames: ["Grace Hopper"] },
    { teamCode: "T03", name: "DeepThinkers", university: "State University", track: "AI/ML", memberNames: ["Geoffrey H.", "Yoshua B."] },
  ];
  for (const t of teams) {
    await prisma.team.upsert({ where: { teamCode: t.teamCode }, update: {}, create: t });
  }

  console.log("Seeded. Organizer login: organizer@example.com / organizer123");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
