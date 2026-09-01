import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getSubmissionDetail } from "@/lib/dashboard";
import { SubmissionDetailView } from "@/components/SubmissionDetail";

export const dynamic = "force-dynamic";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") {
    redirect("/login?error=forbidden");
  }

  const { id } = await params;
  const detail = await getSubmissionDetail(id);
  if (!detail) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/organizer/dashboard"
        className="text-sm text-indigo-600 hover:underline"
      >
        ← Dashboard
      </Link>
      <SubmissionDetailView detail={detail} />
    </main>
  );
}
