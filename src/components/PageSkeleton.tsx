import { Skeleton } from "@/components/ui/misc";

/** Simple page-level loading placeholder (title, a summary card, a list). */
export function PageSkeleton({ label = "Loading…", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <Skeleton className="mb-4 h-28 w-full rounded-xl" />
      <div className="card divide-y divide-[var(--glass-border)]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
