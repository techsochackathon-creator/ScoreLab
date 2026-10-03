import { PageSkeleton } from "@/components/PageSkeleton";

export default function LeaderboardLoading() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-5 sm:py-10">
        <PageSkeleton label="Loading results…" rows={5} />
      </div>
    </div>
  );
}
