import TopBar from "@/components/TopBar";
import NewCohortForm from "@/components/NewCohortForm";

export default function NewCohortPage() {
  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <NewCohortForm />
    </div>
  );
}
