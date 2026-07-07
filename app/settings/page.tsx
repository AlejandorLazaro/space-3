"use client";

import TopBar from "@/components/TopBar";
import RequireAuth from "@/components/RequireAuth";
import CalendarFeedPanel from "@/components/settings/CalendarFeedPanel";

export default function SettingsPage() {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <h1 className="font-display mb-8 text-2xl">Settings</h1>
          <CalendarFeedPanel />
        </main>
      </div>
    </RequireAuth>
  );
}