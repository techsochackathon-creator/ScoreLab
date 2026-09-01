const STYLES: Record<string, string> = {
  QUEUED: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  RUNNING: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  CANCELLED: "bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  none: "bg-gray-100 text-gray-400 dark:bg-gray-900 dark:text-gray-500",
};

export function JobStatusBadge({ status }: { status: string | null }) {
  const s = status ?? "none";
  const label = status ? status.toLowerCase() : "no job";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
        STYLES[s] ?? STYLES.none
      }`}
    >
      {s === "RUNNING" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      )}
      {label}
    </span>
  );
}
