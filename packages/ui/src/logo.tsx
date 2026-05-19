import * as React from 'react';
import { colors } from './tokens.js';

/**
 * Medixus brand mark. Uses the official logo asset (copied into the app's
 * /public/brand by setup); falls back to a styled wordmark if absent.
 */
export function MedixusLogo({
  src = '/brand/medixus-logo.png',
  height = 28,
  withWordmark = true,
}: {
  src?: string;
  height?: number;
  withWordmark?: boolean;
}) {
  const [broken, setBroken] = React.useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {!broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Medixus"
          height={height}
          style={{ height, width: 'auto', display: 'block' }}
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          style={{
            fontWeight: 800,
            fontSize: height * 0.8,
            color: colors.accent,
            letterSpacing: '0.02em',
          }}
        >
          Medixus
        </span>
      )}
      {withWordmark && (
        <span style={{ fontWeight: 700, fontSize: 15, color: colors.ink }}>カルテ</span>
      )}
    </span>
  );
}
