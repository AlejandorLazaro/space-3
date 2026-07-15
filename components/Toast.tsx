"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Imperative toast API — callable from anywhere, including plain lib
 * functions with no access to React context. Module-level pub-sub rather
 * than a Context provider, specifically so this doesn't require wrapping
 * the app in a new provider at the root (which would mean guessing at
 * app/layout.tsx's structure, which hasn't been shared).
 */
export function showToast(message: string, type: ToastType = "info", durationMs = 5000): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
  return id;
}

export function showErrorToast(message: string, durationMs = 7000): number {
  return showToast(message, "error", durationMs);
}

export function showSuccessToast(message: string, durationMs = 4000): number {
  return showToast(message, "success", durationMs);
}

/**
 * Mount this once anywhere in the tree — it portals to document.body, so
 * placement in the DOM doesn't matter. Multiple mounts are harmless (each
 * just subscribes independently), but one is enough; add it wherever's
 * convenient per page/section that needs toasts until a root layout mount
 * point is established.
 */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (typeof document === "undefined" || items.length === 0) return null;

  return createPortal(
    <div className="fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={
            "flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg " +
            (t.type === "error"
              ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
              : t.type === "success"
                ? "border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] text-[var(--color-teal)]"
                : "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink)]")
          }
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}