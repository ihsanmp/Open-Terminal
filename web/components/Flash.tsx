"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Flash phase after `value` changes: 2 = bright, 1 = fading, 0 = idle.
 * Two timed steps instead of a CSS fade: a 450ms background-color animation
 * renders ~27 frames per changed cell, these steps render three.
 */
export function useFlash(value: string | number | null | undefined): 0 | 1 | 2 {
  const prev = useRef(value);
  const [phase, setPhase] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (value !== undefined && value !== null && prev.current !== value && prev.current !== undefined && prev.current !== null) {
      prev.current = value;
      setPhase(2);
      const t1 = setTimeout(() => setPhase(1), 150);
      const t2 = setTimeout(() => setPhase(0), 450);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    prev.current = value;
  }, [value]);

  return phase;
}

/** Wraps children in a span that briefly flashes white whenever `value` changes. */
export default function Flash({
  value,
  className,
  children,
}: {
  value: string | number | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const phase = useFlash(value);
  return <span className={`${className ?? ""} ${phase === 2 ? "flash-on" : phase === 1 ? "flash-fade" : ""}`}>{children}</span>;
}
