/** Design tokens — aligned with Medixus_OS_設計書.html palette for brand continuity. */
export const colors = {
  bg: '#ffffff',
  ink: '#1a1a1a',
  muted: '#666666',
  line: '#d7d7d7',
  soft: '#f6f6f6',
  accent: '#0b5f37', // medixus green
  warn: '#8a5a00',
  alert: '#8a2b2b',
  blue: '#174a7c',
  teal: '#0a6e6e',
  purple: '#5b3a8c',
  highlight: '#fff7df',
} as const;

export const severityColor = {
  red: { fg: '#8a2b2b', bg: '#faeeee', border: '#8a2b2b' },
  amber: { fg: '#8a5a00', bg: '#fff7df', border: '#8a5a00' },
  green: { fg: '#0b5f37', bg: '#eaf5ee', border: '#0b5f37' },
} as const;
