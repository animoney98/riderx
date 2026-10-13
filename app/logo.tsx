'use client';
import { useRef, useState } from 'react';

/** The RiderX "X" mark. Click or tap it and it glows and a shine sweeps across. Purely decorative: it does not navigate. */
export function Logo({ size = 40 }: { size?: number }) {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = () => {
    if (timer.current) clearTimeout(timer.current);
    setOn(false);
    requestAnimationFrame(() => {
      setOn(true);
      timer.current = setTimeout(() => setOn(false), 1500);
    });
  };
  return (
    <button type="button" className={`xlogo${on ? ' go' : ''}`} style={{ width: size, height: size }} onClick={fire} aria-label="RiderX">
      <img src="/riderx-x.png" alt="" width={size} height={size} draggable={false} />
      <span className="xshine" aria-hidden="true" />
    </button>
  );
}
