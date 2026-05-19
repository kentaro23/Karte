'use client';
import * as React from 'react';
import { SOAP_LABEL, type SoapBlock, type SoapKind } from '@medixus/domain';
import { Textarea } from './primitives.js';

/** SOAP記載 — 別紙1 §3.1(1). Sectioned S/O/A/P. */
export function SoapEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: SoapBlock[];
  onChange: (v: SoapBlock[]) => void;
  readOnly?: boolean;
}) {
  const keys: SoapKind[] = ['S', 'O', 'A', 'P'];
  const get = (k: SoapKind) =>
    value.find((b) => b.kind === k)?.spans.map((s) => s.text).join('') ?? '';
  const set = (k: SoapKind, text: string) => {
    onChange(keys.map((kk) => ({ kind: kk, spans: [{ text: kk === k ? text : get(kk) }] })));
  };
  return (
    <div className="flex flex-col gap-3">
      {keys.map((k) => (
        <div key={k} className="flex flex-col gap-1">
          <span className="text-xs font-bold text-accent-700">{SOAP_LABEL[k]}</span>
          <Textarea
            value={get(k)}
            readOnly={readOnly}
            onChange={(e) => set(k, e.target.value)}
            rows={k === 'S' || k === 'O' ? 4 : 3}
            placeholder={readOnly ? '' : `${SOAP_LABEL[k]} を入力`}
          />
        </div>
      ))}
    </div>
  );
}
