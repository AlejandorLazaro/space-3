"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { requiresOriginationWarning } from "@/lib/originationWarning";
import type { Cohort, CohortVisibility, CohortAdmissionMode } from "@/lib/types";
import { Card, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type PendingSettingChange =
  | { field: "visibility"; next: CohortVisibility }
  | { field: "admission_mode"; next: CohortAdmissionMode };

export default function SettingsPanel({
  cohort,
  userId,
  onChange,
}: {
  cohort: Cohort;
  userId: string;
  onChange: (next: Cohort) => void;
}) {
  const [dialog, setDialog] = useState<{
    open: boolean;
    creatorActive: boolean;
    creatorName: string | null;
  }>({ open: false, creatorActive: true, creatorName: null });
  const [pending, setPending] = useState<PendingSettingChange | null>(null);

  async function requestChange(change: PendingSettingChange) {
    const { warn, creatorActive } = await requiresOriginationWarning(
      userId,
      { created_by: cohort.created_by },
      cohort.id
    );

    if (!warn) {
      await applyChange(change);
      return;
    }

    let creatorName: string | null = null;
    if (creatorActive) {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", cohort.created_by)
        .maybeSingle();
      creatorName = data?.display_name ?? null;
    }

    setPending(change);
    setDialog({ open: true, creatorActive, creatorName });
  }

  async function applyChange(change: PendingSettingChange) {
    const supabase = createClient();
    const patch =
      change.field === "visibility"
        ? { visibility: change.next }
        : { admission_mode: change.next };

    const { error } = await supabase.from("cohorts").update(patch).eq("id", cohort.id);
    if (error) {
      console.error("Failed to update cohort settings:", error);
      return;
    }
    onChange({ ...cohort, ...patch });
  }

  function closeDialog() {
    setPending(null);
    setDialog({ open: false, creatorActive: true, creatorName: null });
  }

  return (
    <div>
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <p className="mb-1.5 text-xs text-[var(--color-ink-soft)]">Visibility</p>
          <div className="flex gap-2">
            <Button
              variant={cohort.visibility === "public" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => requestChange({ field: "visibility", next: "public" })}
            >
              Public
            </Button>
            <Button
              variant={cohort.visibility === "private" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => requestChange({ field: "visibility", next: "private" })}
            >
              Private
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-[var(--color-ink-soft)]">Admission</p>
          <div className="flex gap-2">
            <Button
              variant={cohort.admission_mode === "apply" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => requestChange({ field: "admission_mode", next: "apply" })}
            >
              Apply
            </Button>
            <Button
              variant={cohort.admission_mode === "invite_only" ? "primary" : "secondary"}
              className="flex-1"
              onClick={() => requestChange({ field: "admission_mode", next: "invite_only" })}
            >
              Invite only
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={dialog.open}
        title="Change this cohort's settings?"
        body={
          dialog.creatorActive && dialog.creatorName
            ? `This cohort was set up by ${dialog.creatorName}. Changing this setting affects every member — continue?`
            : "This cohort's original creator is no longer an active member. Changing this setting affects every member — continue?"
        }
        confirmLabel="Change setting"
        cancelLabel="Cancel"
        onCancel={closeDialog}
        onConfirm={() => {
          if (pending) applyChange(pending);
          closeDialog();
        }}
      />
    </div>
  );
}