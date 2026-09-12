import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrCreateRubric } from "@/lib/rubric";
import { prisma } from "@/lib/prisma";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SectionTitle } from "@/components/ui/misc";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const [rubric, teamsCount, evalCount] = await Promise.all([
    getOrCreateRubric(),
    prisma.team.count(),
    prisma.submission.count({ where: { status: "EVALUATED" } }),
  ]);

  return (
    <div className="fade-in-up max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-2">Appearance, rubric, and account.</p>
      </header>

      <div className="flex flex-col gap-4">
        <section className="card p-5">
          <SectionTitle>Appearance</SectionTitle>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-ink">Theme</div>
              <div className="text-xs text-ink-3">Switch between the dark AI command center and light mode.</div>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <section className="card p-5">
          <SectionTitle right={<Link href="/organizer/rubric" className="link-brand text-xs">Edit →</Link>}>Rubric</SectionTitle>
          <div className="text-sm text-ink">{rubric.name}</div>
          <div className="mt-1 text-xs text-ink-3">{rubric.criteria.length} criteria · weights sum to {rubric.criteria.reduce((a, c) => a + c.weight, 0)}%</div>
        </section>

        <section className="card p-5">
          <SectionTitle>Data</SectionTitle>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-3">Teams</dt><dd className="nums text-right font-semibold text-ink">{teamsCount}</dd>
            <dt className="text-ink-3">Completed evaluations</dt><dd className="nums text-right font-semibold text-ink">{evalCount}</dd>
          </dl>
        </section>

        <section className="card p-5">
          <SectionTitle>Account</SectionTitle>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
                style={{ background: "var(--brand-tint)", color: "var(--brand)" }}
              >
                {(session?.user.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <div>
                <div className="text-sm text-ink">{session?.user.email}</div>
                <div className="text-xs text-ink-3">Organizer</div>
              </div>
            </div>
            <SignOutButton />
          </div>
        </section>
      </div>
    </div>
  );
}
