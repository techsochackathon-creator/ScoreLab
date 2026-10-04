import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { homePathForRole } from "@/lib/roles";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Logo } from "@/components/ui/Logo";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const home = homePathForRole(session?.user?.role);

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6">
        <div className="flex items-center justify-between py-6">
          <Logo />
          <ThemeToggle />
        </div>

        <main className="flex flex-1 flex-col justify-center py-16">
          <span className="inline-flex w-fit items-center gap-2 rounded border border-hair-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Evaluation intelligence
          </span>
          <h1 className="mt-5 text-[32px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[44px]">
            Fair, consistent scoring<br />for every hackathon team.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-2">
            Point ScoreLab at a team&apos;s GitHub repository. It gathers evidence through the GitHub API,
            scores it against your rubric with Claude, and ranks every team — transparently.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={home ?? "/login"} className="btn-primary">
              {home ? "Open dashboard" : "Sign in"}
            </Link>
            <Link href="/leaderboard" className="btn-ghost">View leaderboard</Link>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Rubric-driven", "Weighted criteria with 1–5 anchor descriptions you control."],
              ["Evidence-based", "README, structure, and commit signals — no code execution."],
              ["Transparent", "Every score comes with the model&apos;s reasoning."],
            ].map(([t, d]) => (
              <div key={t} className="card p-4">
                <div className="text-sm font-semibold text-ink">{t}</div>
                <p className="mt-1 text-xs leading-relaxed text-ink-3" dangerouslySetInnerHTML={{ __html: d }} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
