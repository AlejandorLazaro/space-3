"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type PopoverAlign = "left" | "right" | "center";

interface PopoverProps {
  /** A single focusable element (button, link, etc.) that opens the popover on click. */
  trigger: ReactElement;
  /** Popover content. */
  children: ReactNode;
  /** Horizontal alignment of the content panel relative to the trigger. Default: "left". */
  align?: PopoverAlign;
  /** Extra classes merged onto the content panel. */
  className?: string;
}

/**
 * Shared popover primitive: click a trigger, show a floating panel, close on
 * outside click or Escape. Intended for reuse anywhere in the app.
 *
 * Rendered via a portal into document.body, positioned using the trigger's
 * real viewport coordinates — NOT CSS `position: absolute` nested inside
 * the trigger's own DOM parent. That earlier approach silently broke inside
 * any ancestor with overflow set on one axis (e.g. `overflow-x-auto` for a
 * scrollable tab bar): per the CSS spec, constraining one axis forces the
 * other to clip too, so a popover positioned below/beside its trigger would
 * render completely invisible, clipped by the scrollable ancestor, even
 * though its click handler and open state were working correctly the whole
 * time. Portal rendering sidesteps this entirely — the popover is no longer
 * a DOM descendant of whatever container it was triggered from.
 */
export default function Popover({
  trigger,
  children,
  align = "left",
  className = "",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = align === "right" ? rect.right + window.scrollX : rect.left + window.scrollX;
    setCoords({ top: rect.bottom + window.scrollY + 6, left });
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insideContent = contentRef.current?.contains(target);
      if (!insideTrigger && !insideContent) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleReposition() {
      updatePosition();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  const triggerWithHandlers = isValidElement(trigger)
    ? cloneElement(trigger, {
        ref: triggerRef,
        onClick: (e: MouseEvent) => {
          (trigger.props as { onClick?: (e: MouseEvent) => void }).onClick?.(e);
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      } as Partial<unknown>)
    : trigger;

  const alignTransform =
    align === "right" ? "translateX(-100%)" : align === "center" ? "translateX(-50%)" : undefined;

  return (
    <>
      {triggerWithHandlers}
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contentRef}
            role="dialog"
            className={`fixed z-50 w-72 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-3 shadow-lg ${className}`}
            style={{ top: coords.top, left: coords.left, transform: alignTransform }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}