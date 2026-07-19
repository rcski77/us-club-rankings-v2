"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingText?: string;
};

// Next.js server actions redirect/reload the page on completion, so a plain
// <button type="submit"> gives no feedback between click and that reload -- on a
// slow action (e.g. Resolve/Commit over a thousand-row import batch) it just looks
// unresponsive. useFormStatus reads the pending state of the nearest enclosing
// <form>, so this only works as a child of the form it's submitting -- this is the
// one client component in the app, kept as a small, isolated leaf for exactly this.
export function SubmitButton({ children, pendingText, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} {...props}>
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {pendingText ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
