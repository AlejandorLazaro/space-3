"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Textarea, Label, Card } from "@/components/ui";
import type { ContextType } from "@/lib/types";

const CONTEXT_TYPES: ContextType[] = [
  "alumni",
  "workplace",
  "neighborhood",
  "faith",
  "interest",
  "other",
];

export default function NewCohortForm() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [contextType, setContextType] = useState<ContextType>("alumni");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("cohorts")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        city: city.trim() || null,
        context_type: contextType,
        created_by: user.id,
      })
      .select()
      .single();

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/groups?id=${data.id}`);
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-8">
      <h1 className="font-display mb-1 text-2xl">New cohort</h1>
      <p className="mb-6 text-sm text-[var(--color-ink-soft)]">
        You&rsquo;ll be the first admin — approve applications and get the first message going.
      </p>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label>Name</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="UT Austin — Houston"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For alumni who landed in Houston after graduating."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>City</Label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Houston"
              />
            </div>
            <div>
              <Label>Context</Label>
              <select
                value={contextType}
                onChange={(e) => setContextType(e.target.value as ContextType)}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
              >
                {CONTEXT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" disabled={loading} className="mt-1">
            {loading ? "Creating…" : "Create cohort"}
          </Button>
        </form>
      </Card>
    </div>
  );
}