import { PrismaClient, CheckType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const web = await prisma.track.upsert({
    where: { slug: "web" },
    update: {},
    create: { name: "Web", slug: "web", description: "Web applications" },
  });
  await prisma.track.upsert({
    where: { slug: "ai" },
    update: {},
    create: { name: "AI/ML", slug: "ai", description: "AI & ML projects" },
  });

  const rubric = await prisma.rubric.upsert({
    where: { name_trackId: { name: "Web Default Rubric", trackId: web.id } },
    update: {},
    create: { name: "Web Default Rubric", trackId: web.id },
  });

  const criteria: Array<{
    name: string;
    checkType: CheckType;
    weight: number;
    scoringRules: object;
  }> = [
    {
      name: "Uptime",
      checkType: CheckType.uptime,
      weight: 0.15,
      scoringRules: { passPoints: 100, failPoints: 0, pings: 3, timeoutMs: 5000 },
    },
    {
      name: "Lighthouse Performance",
      checkType: CheckType.lighthouse_perf,
      weight: 0.2,
      scoringRules: { mode: "raw", maxPoints: 100 },
    },
    {
      name: "Lighthouse Accessibility",
      checkType: CheckType.lighthouse_a11y,
      weight: 0.15,
      scoringRules: { mode: "raw", maxPoints: 100 },
    },
    {
      name: "Responsiveness",
      checkType: CheckType.responsiveness,
      weight: 0.1,
      scoringRules: { viewports: [375, 768, 1440], pointsPerViewport: 33.3 },
    },
    {
      name: "Build Success",
      checkType: CheckType.build_success,
      weight: 0.15,
      scoringRules: { passPoints: 100, failPoints: 0 },
    },
    {
      name: "Code Quality",
      checkType: CheckType.code_quality,
      weight: 0.1,
      scoringRules: {
        subChecks: [
          { key: "readme", label: "README present", enabled: true, points: 30 },
          { key: "tests", label: "Tests present", enabled: true, points: 40 },
          {
            key: "commits",
            label: "Min commits per teammate",
            enabled: true,
            points: 30,
            minCommitsPerTeammate: 3,
          },
        ],
      },
    },
    {
      name: "Judge Score",
      checkType: CheckType.human_score,
      weight: 0.15,
      scoringRules: { maxScore: 10 },
    },
  ];

  for (const c of criteria) {
    const existing = await prisma.rubricCriterion.findFirst({
      where: { rubricId: rubric.id, name: c.name },
    });
    if (!existing) {
      await prisma.rubricCriterion.create({ data: { rubricId: rubric.id, ...c } });
    }
  }

  const organizerPass = await bcrypt.hash("organizer123", 10);
  await prisma.user.upsert({
    where: { email: "organizer@example.com" },
    update: {},
    create: {
      email: "organizer@example.com",
      name: "Lead Organizer",
      passwordHash: organizerPass,
      role: "ORGANIZER",
    },
  });

  const team = await prisma.team.upsert({
    where: { name_trackId: { name: "Team Rocket", trackId: web.id } },
    update: {},
    create: { name: "Team Rocket", university: "State University", trackId: web.id },
  });

  const teamPass = await bcrypt.hash("team123", 10);
  await prisma.user.upsert({
    where: { email: "team@example.com" },
    update: {},
    create: {
      email: "team@example.com",
      name: "Team Rocket Captain",
      passwordHash: teamPass,
      role: "TEAM",
      teamId: team.id,
    },
  });

  console.log("Seeded. Logins:");
  console.log("  organizer@example.com / organizer123");
  console.log("  team@example.com / team123");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
