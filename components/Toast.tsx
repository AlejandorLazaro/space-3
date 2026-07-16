"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Set right before actual removal, so the exit transition has something to animate toward before the item leaves the array entirely. */
  leaving?: boolean;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

// How long the fade transition takes. Kept as a plain number for the
// setTimeout delay below; the Tailwind class in ToastItemView (duration-200)
// is a separate, hardcoded literal that must be kept in sync with this by
// hand — Tailwind's compiler only generates CSS for class names it can see
// as literal strings in source, so `duration-${FADE_MS}` would silently
// produce no CSS at all rather than the intended transition-duration.
const FADE_MS = 200;

function emit() {
  for (const l of listeners) l([...toasts]);
}

function removeToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Two-phase dismiss: mark as leaving (triggers the fade-out transition in
 * the rendered item), then actually remove it from state once the
 * transition has had time to play. A toast that's just yanked out of the
 * array immediately has nothing to animate — the fade would never be seen.
 */
function requestDismiss(id: number) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => removeToast(id), FADE_MS);
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
  if (durationMs > 0) setTimeout(() => requestDismiss(id), durationMs);
  return id;
}

export function showErrorToast(message: string, durationMs = 7000): number {
  return showToast(message, "error", durationMs);
}

export function showSuccessToast(message: string, durationMs = 4000): number {
  return showToast(message, "success", durationMs);
}

function toneClasses(type: ToastType) {
  // "More opaque, still a bit of transparency" — /90 background rather than
  // fully solid or the earlier very-light /10 tint.
  if (type === "error") return "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/90 text-white";
  if (type === "success") return "border-[var(--color-teal)]/40 bg-[var(--color-teal)]/90 text-white";
  return "border-[var(--color-line)] bg-[var(--color-paper)]/90 text-[var(--color-ink)]";
}

function ToastItemView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  // Starts hidden, flips to visible one frame after mount — gives the
  // browser a paint with opacity-0 first, so the transition to opacity-100
  // actually has something to animate from instead of just appearing.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const visible = entered && !toast.leaving;

  return (
    <div
      role="alert"
      className={
        "pointer-events-auto inline-flex w-fit max-w-[90vw] items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg transition-all duration-200 ease-out " +
        (visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2") +
        " " +
        toneClasses(toast.type)
      }
    >
      <span className="whitespace-pre-wrap break-words">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
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
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <ToastItemView key={t.id} toast={t} onDismiss={requestDismiss} />
      ))}
    </div>,
    document.body
  );
}