"use client";
import { useEffect, useRef } from "react";

interface Props {
  onComplete: () => void;
}

// E2E mass-encryption is disabled — vault encryption is now opt-in per-note only.
// E2EReversal.tsx handles decrypting any previously encrypted data back to plaintext.
export default function E2EMigration({ onComplete }: Props) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    onComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
