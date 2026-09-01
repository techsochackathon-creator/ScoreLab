import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SubmissionForm } from "@/components/SubmissionForm";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "TEAM" || !session.user.teamId) {
    redirect("/login?error=forbidden");
  }

  const team = await prisma.team.findUnique({
    where: { id: session.user.teamId },
    include: { track: true },
  });
  if (!team) redirect("/login?error=forbidden");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Submit your project</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {team.name} · {team.university} · Track: {team.track.name}
        </p>
      </header>
      <SubmissionForm />
    </main>
  );
}
