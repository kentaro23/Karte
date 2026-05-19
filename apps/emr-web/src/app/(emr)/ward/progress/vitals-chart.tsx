'use client';
import * as React from 'react';

export interface VitalPoint {
  at: string; // ISO
  temp?: number;
  sys?: number;
  dia?: number;
  pulse?: number;
  spo2?: number;
}

/** 熱型表（体温折れ線＋脈拍＋血圧＋SpO2）。SVG・依存なし・レスポンシブ。 */
export function VitalsChart({ points }: { points: VitalPoint[] }) {
  const pts = [...points].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const W = 760;
  const H = 260;
  const PAD = { l: 40, r: 40, t: 16, b: 64 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  // temp scale 35.0–40.0 (left axis), pulse 40–160 (right axis)
  const tMin = 35;
  const tMax = 40;
  const pMin = 40;
  const pMax = 160;
  const n = pts.length;
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const yT = (v: number) => PAD.t + ih - ((v - tMin) / (tMax - tMin)) * ih;
  const yP = (v: number) => PAD.t + ih - ((v - pMin) / (pMax - pMin)) * ih;

  const tempPath = pts
    .map((p, i) => (p.temp == null ? null : `${x(i)},${yT(p.temp)}`))
    .filter(Boolean)
    .join(' ');
  const pulsePath = pts
    .map((p, i) => (p.pulse == null ? null : `${x(i)},${yP(p.pulse)}`))
    .filter(Boolean)
    .join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }}>
        {/* normal temp band 36.0–37.0 */}
        <rect
          x={PAD.l}
          y={yT(37)}
          width={iw}
          height={yT(36) - yT(37)}
          fill="#eaf5ee"
        />
        {/* temp gridlines */}
        {[35, 36, 37, 38, 39, 40].map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={yT(v)} x2={W - PAD.r} y2={yT(v)} stroke="#eee" />
            <text x={PAD.l - 6} y={yT(v) + 3} textAnchor="end" fontSize="9" fill="#8a2b2b">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {/* right pulse axis labels */}
        {[40, 80, 120, 160].map((v) => (
          <text key={v} x={W - PAD.r + 6} y={yP(v) + 3} fontSize="9" fill="#174a7c">
            {v}
          </text>
        ))}
        <text x={PAD.l - 6} y={PAD.t - 4} textAnchor="end" fontSize="9" fill="#8a2b2b">
          ℃
        </text>
        <text x={W - PAD.r + 6} y={PAD.t - 4} fontSize="9" fill="#174a7c">
          /分
        </text>

        {/* pulse line */}
        {pulsePath && (
          <polyline points={pulsePath} fill="none" stroke="#174a7c" strokeWidth="1.5" opacity="0.85" />
        )}
        {/* temp line */}
        {tempPath && (
          <polyline points={tempPath} fill="none" stroke="#8a2b2b" strokeWidth="2" />
        )}

        {pts.map((p, i) => {
          const d = new Date(p.at);
          return (
            <g key={i}>
              {p.pulse != null && <circle cx={x(i)} cy={yP(p.pulse)} r="2.5" fill="#174a7c" />}
              {p.temp != null && (
                <>
                  <circle cx={x(i)} cy={yT(p.temp)} r="3" fill="#8a2b2b" />
                  <text x={x(i)} y={yT(p.temp) - 7} textAnchor="middle" fontSize="9" fill="#8a2b2b">
                    {p.temp.toFixed(1)}
                  </text>
                </>
              )}
              {/* x labels */}
              <text
                x={x(i)}
                y={H - PAD.b + 16}
                textAnchor="middle"
                fontSize="8.5"
                fill="#666"
              >
                {`${d.getMonth() + 1}/${d.getDate()}`}
              </text>
              <text x={x(i)} y={H - PAD.b + 27} textAnchor="middle" fontSize="8" fill="#999">
                {`${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`}
              </text>
              {/* BP / SpO2 row */}
              {(p.sys != null || p.spo2 != null) && (
                <text x={x(i)} y={H - PAD.b + 40} textAnchor="middle" fontSize="8" fill="#444">
                  {p.sys != null ? `${p.sys}/${p.dia ?? '-'}` : ''}
                </text>
              )}
              {p.spo2 != null && (
                <text x={x(i)} y={H - PAD.b + 51} textAnchor="middle" fontSize="8" fill="#0a6e6e">
                  {p.spo2}%
                </text>
              )}
            </g>
          );
        })}

        {/* legend */}
        <g transform={`translate(${PAD.l},${H - 8})`} fontSize="9">
          <circle cx="4" cy="-3" r="3" fill="#8a2b2b" />
          <text x="12" y="0" fill="#8a2b2b">体温</text>
          <circle cx="56" cy="-3" r="3" fill="#174a7c" />
          <text x="64" y="0" fill="#174a7c">脈拍</text>
          <text x="104" y="0" fill="#444">血圧(収/拡)</text>
          <text x="176" y="0" fill="#0a6e6e">SpO2</text>
        </g>
      </svg>
    </div>
  );
}
