import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Hackathon Evaluation System
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Teams submit their projects (repo, live URL, pitch deck, run manifest);
          organizers run automated rubric-based evaluations.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        {!session && (
          <Link
            href="/login"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500"
          >
            Sign in
          </Link>
        )}
        {session?.user.role === "TEAM" && (
          <Link
            href="/submit"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500"
          >
            Submit your project
          </Link>
        )}
        {session?.user.role === "ORGANIZER" && (
          <>
            <Link
              href="/organizer/dashboard"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500"
            >
              Dashboard
            </Link>
            <Link
              href="/organizer/rubrics"
              className="rounded-lg border border-indigo-600 px-5 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
            >
              Rubrics
            </Link>
            <Link
              href="/organizer/leaderboard"
              className="rounded-lg border border-indigo-600 px-5 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
            >
              Leaderboard
            </Link>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/leaderboard" className="text-indigo-600 hover:underline">
          Public leaderboards
        </Link>
        <Link href="/methodology" className="text-indigo-600 hover:underline">
          Scoring methodology
        </Link>
      </div>

      {session && (
        <p className="text-sm text-gray-500">
          Signed in as {session.user.email} ({session.user.role})
        </p>
      )}
    </main>
  );
}
