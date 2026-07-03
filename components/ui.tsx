import { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import clsx from "clsx";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-amber)]",
        variant === "primary" &&
          "bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-ink)]/85",
        variant === "secondary" &&
          "bg-[var(--color-paper)] text-[var(--color-ink)] border border-[var(--color-line)] hover:border-[var(--color-ink-faint)]",
        variant === "ghost" &&
          "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-black/5",
        variant === "danger" &&
          "bg-[var(--color-danger)] text-[var(--color-paper)] hover:bg-[var(--color-danger)]/85",
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-amber)]",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-amber)]",
        className
      )}
      {...props}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-soft)] font-mono-tag">
      {children}
    </label>
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)]",
        className
      )}
      {...props}
    />
  );
}

export function Tag({
  children,
  tone = "teal",
}: {
  children: React.ReactNode;
  tone?: "teal" | "amber";
}) {
  return (
    <span
      className={clsx(
        "font-mono-tag inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        tone === "teal" && "bg-[var(--color-teal-soft)] text-[var(--color-teal)]",
        tone === "amber" && "bg-[var(--color-amber-soft)] text-[var(--color-amber)]"
      )}
    >
      {children}
    </span>
  );
}
