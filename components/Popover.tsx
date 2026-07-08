"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Card } from "@/components/ui";

type PopoverAlign = "left" | "right" | "center";

interface PopoverProps {
  /** A single focusable element (button, link, etc.) that opens the popover on click. */
  trigger: ReactElement;
  /** Popover content. Rendered inside a Card so it matches the app's existing surface styling. */
  children: ReactNode;
  /** Horizontal alignment of the content panel relative to the trigger. Default: "left". */
  align?: PopoverAlign;
  /** Extra classes merged onto the content panel's Card. */
  className?: string;
}

/**
 * Shared popover primitive: click a trigger, show a floating panel, close on
 * outside click or Escape. Intended for reuse anywhere in the app that needs
 * a small "?" info button, a menu, or similar floating content — not
 * specific to the calendar feed feature.
 *
 * Usage:
 *   <Popover trigger={<button aria-label="Help">?</button>}>
 *     <p>Explanation text…</p>
 *   </Popover>
 */
export default function Popover({
  trigger,
  children,
  align = "left",
  className = "",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const alignClass =
    align === "right" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";

  const triggerWithHandlers = isValidElement(trigger)
    ? cloneElement(trigger, {
        onClick: (e: MouseEvent) => {
          (trigger.props as { onClick?: (e: MouseEvent) => void }).onClick?.(e);
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      } as Partial<unknown>)
    : trigger;

  return (
    <div ref={containerRef} className="relative inline-block">
      {triggerWithHandlers}
      {open && (
        <Card
          role="dialog"
          className={`absolute z-50 mt-2 w-72 p-3 shadow-lg ${alignClass} ${className}`}
        >
          {children}
        </Card>
      )}
    </div>
  );
}