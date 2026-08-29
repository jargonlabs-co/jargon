-- Jargon context layer table for Supabase
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

create table if not exists public.jargon_prospects (
  id text primary key,
  name text not null,
  title text,
  company text,
  email text,
  phone text,
  city text,
  linkedin_url text,
  company_domain text,
  company_industry text,
  company_size text,
  crustdata_person_id text,
  source text default 'crustdata',
  raw_profile jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jargon_prospects_created_at_idx
  on public.jargon_prospects (created_at desc);

-- Optional: enable RLS if using anon key from the desktop app
alter table public.jargon_prospects enable row level security;

create policy "Allow read for authenticated and service role"
  on public.jargon_prospects
  for select
  using (true);

-- For early testing with service role key, RLS is bypassed automatically.
