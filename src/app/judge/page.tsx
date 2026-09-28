import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judge Dashboard — ScoreLab" };

/** Placeholder — verifies judge auth/routing only. The real dashboard comes later. */
export default async function JudgeDashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="fade-in-up">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Judge Dashboard</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Signed in as {session?.user?.name ?? session?.user?.email}. Your assigned teams will appear here.
      </p>
    </div>
  );
}
