import * as React from 'react';
import { severityColor } from './tokens.js';

export function Badge({
  children,
  tone = 'green',
  title,
}: {
  children: React.ReactNode;
  tone?: 'red' | 'amber' | 'green';
  title?: string;
}) {
  const c = severityColor[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 4,
        color: c.fg,
        background: c.bg,
        border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
