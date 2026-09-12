import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Minimal stroke icon set (currentColor, 1.6px). No external dependency. */
function Base({ children, size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  overview: (p: IconProps) => (
    <Base {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Base>
  ),
  teams: (p: IconProps) => (
    <Base {...p}><circle cx="9" cy="8" r="3" /><path d="M15 11a3 3 0 1 0-2.5-4.6" /><path d="M4 20a5 5 0 0 1 10 0" /><path d="M15 15a5 5 0 0 1 5 5" /></Base>
  ),
  evaluations: (p: IconProps) => (
    <Base {...p}><path d="M3 12h4l2 5 4-12 2 7h6" /></Base>
  ),
  rubric: (p: IconProps) => (
    <Base {...p}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></Base>
  ),
  leaderboard: (p: IconProps) => (
    <Base {...p}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3" /><path d="M7 5H4v2a3 3 0 0 0 3 3" /></Base>
  ),
  analytics: (p: IconProps) => (
    <Base {...p}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></Base>
  ),
  integrity: (p: IconProps) => (
    <Base {...p}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Base>
  ),
  settings: (p: IconProps) => (
    <Base {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></Base>
  ),
  search: (p: IconProps) => (
    <Base {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Base>
  ),
  plus: (p: IconProps) => (<Base {...p}><path d="M12 5v14M5 12h14" /></Base>),
  sun: (p: IconProps) => (
    <Base {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></Base>
  ),
  moon: (p: IconProps) => (<Base {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></Base>),
  external: (p: IconProps) => (<Base {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Base>),
  logout: (p: IconProps) => (<Base {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></Base>),
  menu: (p: IconProps) => (<Base {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Base>),
  close: (p: IconProps) => (<Base {...p}><path d="M6 6l12 12M18 6 6 18" /></Base>),
  chevronRight: (p: IconProps) => (<Base {...p}><path d="m9 6 6 6-6 6" /></Base>),
  trendUp: (p: IconProps) => (<Base {...p}><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></Base>),
  trendDown: (p: IconProps) => (<Base {...p}><path d="M3 7 9 13l4-4 8 8" /><path d="M15 17h6v-6" /></Base>),
  trendFlat: (p: IconProps) => (<Base {...p}><path d="M4 12h16" /></Base>),
  alert: (p: IconProps) => (<Base {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Base>),
  check: (p: IconProps) => (<Base {...p}><path d="m5 12 5 5L20 7" /></Base>),
  spark: (p: IconProps) => (<Base {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" /></Base>),
  runs: (p: IconProps) => (<Base {...p}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></Base>),
};

export type IconName = keyof typeof Icon;
