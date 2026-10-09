"use client";

import { useState } from "react";
import { buttonClass } from "./ui";

export function CopyButton({ text, label = "Salin teks" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Tersalin ✓" : label}
    </button>
  );
}
