export type ContextType =
  | "alumni"
  | "workplace"
  | "neighborhood"
  | "faith"
  | "interest"
  | "other";

export type Cohort = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  context_type: ContextType;
  created_by: string;
  created_at: string;
};

export type Membership = {
  cohort_id: string;
  user_id: string;
  role: "member" | "admin";
  status: "active" | "suspended";
  joined_at: string;
};

export type Application = {
  id: string;
  cohort_id: string;
  applicant_id: string;
  connection_note: string;
  status: "pending" | "approved" | "declined";
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  profiles?: { display_name: string } | null;
};

export type Message = {
  id: string;
  cohort_id: string;
  author_id: string;
  content: string;
  created_at: string;
  profiles?: { display_name: string } | null;
};

export type Profile = {
  id: string;
  display_name: string;
  city: string | null;
};
