'use client';
import { useState } from 'react';

/** Copies the given text to the clipboard. Falls back to selecting nothing silently, so the text stays visible to copy by hand. */
export function CopyButton({ text, label = 'Copy script' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setState('done'); } catch { setState('failed'); }
        setTimeout(() => setState('idle'), 2500);
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Could not copy: select the text below instead' : label}
    </button>
  );
}
