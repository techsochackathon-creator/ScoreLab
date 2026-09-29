import { PageSkeleton } from "@/components/PageSkeleton";

/** Page-level loading state (kept per page so routes that call notFound() still return a real 404). */
export default function Loading() {
  return <PageSkeleton label="Loading page…" />;
}
