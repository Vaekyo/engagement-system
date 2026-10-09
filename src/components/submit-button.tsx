"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: "sm" | "md";
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={disabled || pending} className={buttonClass(variant, size)}>
      {pending ? (pendingText ?? "Memproses…") : children}
    </button>
  );
}
