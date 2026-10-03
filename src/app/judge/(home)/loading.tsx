import { PageSkeleton } from "@/components/PageSkeleton";

/** Shown inside the judge layout while the dashboard or a scoring page loads. */
export default function JudgeLoading() {
  return <PageSkeleton label="Loading your evaluations…" rows={3} />;
}
