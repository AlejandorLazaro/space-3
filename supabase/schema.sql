-- Space³ PoC schema: groups (cohorts) + chat only.
-- Waves, events, and spin-off are intentionally out of scope — see cut analysis.
-- Run this in the Supabase SQL editor on a fresh project.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- Profiles (extends Supabase Auth's auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  city text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone authenticated can read basic profile info (needed to show names in chat/member lists)
create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Auto-create a profile row on signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Cohorts (groups)
-- ============================================================
create table public.cohorts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  city text,
  context_type text not null default 'other'
    check (context_type in ('alumni', 'workplace', 'neighborhood', 'faith', 'interest', 'other')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.cohorts enable row level security;

-- Anyone authenticated can browse cohorts to decide whether to apply (Discover section, S07)
create policy "cohorts are readable by any authenticated user"
  on public.cohorts for select
  to authenticated
  using (true);

create policy "any authenticated user can create a cohort"
  on public.cohorts for insert
  to authenticated
  with check (auth.uid() = created_by);

-- ============================================================
-- Cohort memberships
-- ============================================================
create table public.cohort_memberships (
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  joined_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  primary key (cohort_id, user_id)
);

alter table public.cohort_memberships enable row level security;

-- Helper: is the current user an active member of a given cohort?
create function public.is_active_member(target_cohort uuid)
returns boolean as $$
  select exists (
    select 1 from public.cohort_memberships
    where cohort_id = target_cohort
      and user_id = auth.uid()
      and status = 'active'
  );
$$ language sql security definer stable set search_path = public;

create policy "members can see other members of their own cohorts"
  on public.cohort_memberships for select
  to authenticated
  using (public.is_active_member(cohort_id));

-- The creator is auto-enrolled as admin via a trigger (below), not direct insert from clients.
create policy "members can update their own membership row"
  on public.cohort_memberships for update
  to authenticated
  using (auth.uid() = user_id);

create function public.handle_new_cohort()
returns trigger as $$
begin
  insert into public.cohort_memberships (cohort_id, user_id, role, status, approved_by)
  values (new.id, new.created_by, 'admin', 'active', new.created_by);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_cohort_created
  after insert on public.cohorts
  for each row execute procedure public.handle_new_cohort();

-- ============================================================
-- Applications (gated admission — apply, any existing member approves)
-- ============================================================
create table public.applications (
  id uuid primary key default uuid_generate_v4(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  connection_note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (cohort_id, applicant_id)
);

alter table public.applications enable row level security;

create policy "applicants can see their own applications"
  on public.applications for select
  to authenticated
  using (auth.uid() = applicant_id);

create policy "cohort members can see applications to their cohort"
  on public.applications for select
  to authenticated
  using (public.is_active_member(cohort_id));

create policy "any authenticated user can apply"
  on public.applications for insert
  to authenticated
  with check (auth.uid() = applicant_id);

create policy "cohort members can review (update) applications"
  on public.applications for update
  to authenticated
  using (public.is_active_member(cohort_id));

-- When an application is approved, create the membership automatically.
create function public.handle_application_reviewed()
returns trigger as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    insert into public.cohort_memberships (cohort_id, user_id, role, status, approved_by)
    values (new.cohort_id, new.applicant_id, 'member', 'active', new.reviewed_by)
    on conflict (cohort_id, user_id) do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_application_reviewed
  after update on public.applications
  for each row execute procedure public.handle_application_reviewed();

-- ============================================================
-- Chat: single L1 group chat per cohort (v1 PoC scope — no L2/L3)
-- ============================================================
create table public.messages (
  id uuid primary key default uuid_generate_v4(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "members can read messages in their own cohorts"
  on public.messages for select
  to authenticated
  using (public.is_active_member(cohort_id));

create policy "members can post messages in their own cohorts"
  on public.messages for insert
  to authenticated
  with check (public.is_active_member(cohort_id) and auth.uid() = author_id);

-- Realtime: enable for messages and applications (so approval queue + chat update live)
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.applications;
alter publication supabase_realtime add table public.cohort_memberships;
