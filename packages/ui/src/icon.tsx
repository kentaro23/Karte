import * as React from 'react';

/** Compact inline-SVG icon set (stroke, currentColor) for hospital modules + UI. */
export type IconName =
  | 'home'
  | 'patients'
  | 'reception'
  | 'calendar'
  | 'chart'
  | 'order'
  | 'rx'
  | 'injection'
  | 'lab'
  | 'imaging'
  | 'scope'
  | 'dialysis'
  | 'rehab'
  | 'teach'
  | 'chemo'
  | 'surgery'
  | 'blood'
  | 'meal'
  | 'ward'
  | 'bed'
  | 'referral'
  | 'billing'
  | 'master'
  | 'audit'
  | 'users'
  | 'settings'
  | 'search'
  | 'print'
  | 'lock'
  | 'bell'
  | 'board'
  | 'portal'
  | 'chevron'
  | 'plus'
  | 'check'
  | 'x'
  | 'warning'
  | 'edit'
  | 'clock'
  | 'logout'
  | 'refresh'
  | 'schema'
  | 'template'
  | 'sticky'
  | 'pin'
  | 'switch';

const P: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  patients: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 11a3 3 0 0 0 0-6" />
      <path d="M19 20c0-2.5-1.3-4.6-3.2-5.5" />
    </>
  ),
  reception: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18M8 13h8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  chart: (
    <>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  order: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  rx: (
    <>
      <path d="M5 4h5a3 3 0 0 1 0 6H5zM5 10v10M5 10l9 10" />
    </>
  ),
  injection: (
    <>
      <path d="m14 4 6 6M18 6l2-2-2-2-2 2M5 19l8-8 1 1-8 8H5z" />
    </>
  ),
  lab: (
    <>
      <path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3" />
      <path d="M8 3h8M7 15h10" />
    </>
  ),
  imaging: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18M3 12h18" />
    </>
  ),
  scope: (
    <>
      <circle cx="7" cy="17" r="3" />
      <path d="M9 15 20 4M16 4h4v4" />
    </>
  ),
  dialysis: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8l5 3" />
    </>
  ),
  rehab: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v6m0 0 4 6m-4-6-4 6M6 10h12" />
    </>
  ),
  teach: (
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M7 9v5c0 1.7 2.2 3 5 3s5-1.3 5-3V9" />
    </>
  ),
  chemo: (
    <>
      <path d="M10 2h4v6l4 11a2 2 0 0 1-2 3H8a2 2 0 0 1-2-3l4-11z" />
      <path d="M8 14h8" />
    </>
  ),
  surgery: (
    <>
      <path d="M3 17 17 3l4 4L7 21H3z" />
      <path d="M14 6l4 4" />
    </>
  ),
  blood: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  meal: (
    <>
      <path d="M5 3v8a3 3 0 0 0 6 0V3M8 3v18M17 3c-2 0-3 2-3 5s1 5 3 5v8" />
    </>
  ),
  ward: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2" />
    </>
  ),
  bed: (
    <>
      <path d="M3 7v12M3 12h18v7M21 19v-6a3 3 0 0 0-3-3H10v5" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  referral: (
    <>
      <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4z" />
      <path d="M9 13h6M12 10v6" />
    </>
  ),
  billing: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </>
  ),
  master: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M21 20c0-2.5-1.3-4.6-3.2-5.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.06-.32.1-.66.1-1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4-4" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" />
      <rect x="6" y="14" width="12" height="7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  bell: <path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  board: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 9h10M7 13h6M12 18v3" />
    </>
  ),
  portal: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 13 4 4L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  warning: <path d="M12 3 2 20h20zM12 9v5M12 17h.01" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  logout: <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M9 12h11M16 8l4 4-4 4" />,
  refresh: <path d="M20 11a8 8 0 1 0-2 6m2 2v-5h-5" />,
  schema: (
    <>
      <circle cx="12" cy="6" r="2" />
      <path d="M12 8v4m0 0-4 8m4-8 4 8M7 12h10" />
    </>
  ),
  template: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 8h16M9 8v13" />
    </>
  ),
  sticky: <path d="M5 3h14v11l-5 5H5zM14 19v-5h5" />,
  pin: <path d="M12 2l3 7h5l-4 4 2 7-6-4-6 4 2-7-4-4h5z" />,
  switch: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
};

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
