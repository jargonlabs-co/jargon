-- Jargon billing (run in the Supabase SQL editor for the Auth project).
-- The hosted API uses the service role. Website never talks to these tables directly.

create table if not exists public.org_billing (
  org_id text primary key,
  plan text not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.org_billing (org_id) on delete cascade,
  type text not null check (type in ('recurring', 'topup')),
  balance numeric not null default 0,
  next_refresh_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, type)
);

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.org_billing (org_id) on delete cascade,
  wallet_type text not null check (wallet_type in ('recurring', 'topup')),
  source text not null,
  granted numeric not null,
  remaining numeric not null,
  stripe_payment_id text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists credit_lots_org_exp_idx
  on public.credit_lots (org_id, expires_at);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.org_billing (org_id) on delete cascade,
  amount numeric not null,
  reason text not null,
  project_id text,
  api_key_id text,
  environment text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_org_created_idx
  on public.credit_ledger (org_id, created_at desc);

create table if not exists public.usage_daily (
  org_id text not null references public.org_billing (org_id) on delete cascade,
  day date not null,
  emails integer not null default 0,
  calls integer not null default 0,
  linkedin integer not null default 0,
  credits numeric not null default 0,
  primary key (org_id, day)
);

create or replace function public.debit_credits(
  p_org_id text,
  p_amount numeric,
  p_reason text,
  p_project_id text default null,
  p_api_key_id text default null,
  p_environment text default 'live'
) returns jsonb
language plpgsql
as $$
declare
  v_recurring numeric;
  v_topup numeric;
  v_left numeric;
  v_take numeric;
  v_lot record;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', true, 'creditsUsed', 0);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id));

  select coalesce(balance, 0) into v_recurring
  from public.credit_wallets
  where org_id = p_org_id and type = 'recurring';
  v_recurring := coalesce(v_recurring, 0);

  select coalesce(sum(remaining), 0) into v_topup
  from public.credit_lots
  where org_id = p_org_id
    and wallet_type = 'topup'
    and remaining > 0
    and (expires_at is null or expires_at > now());
  v_topup := coalesce(v_topup, 0);

  if (v_recurring + v_topup) < p_amount then
    return jsonb_build_object(
      'ok', false,
      'remaining', v_recurring + v_topup,
      'code', 'insufficient_credits'
    );
  end if;

  v_left := p_amount;

  if v_recurring > 0 then
    v_take := least(v_recurring, v_left);
    update public.credit_wallets
      set balance = balance - v_take, updated_at = now()
      where org_id = p_org_id and type = 'recurring';
    v_left := v_left - v_take;
  end if;

  for v_lot in
    select id, remaining
    from public.credit_lots
    where org_id = p_org_id
      and wallet_type = 'topup'
      and remaining > 0
      and (expires_at is null or expires_at > now())
    order by coalesce(expires_at, 'infinity'::timestamptz), granted_at
  loop
    exit when v_left <= 0;
    v_take := least(v_lot.remaining, v_left);
    update public.credit_lots set remaining = remaining - v_take where id = v_lot.id;
    v_left := v_left - v_take;
  end loop;

  update public.credit_wallets w
    set balance = coalesce((
      select sum(remaining) from public.credit_lots
      where org_id = p_org_id and wallet_type = 'topup'
    ), 0),
        updated_at = now()
    where w.org_id = p_org_id and w.type = 'topup';

  insert into public.credit_ledger (org_id, amount, reason, project_id, api_key_id, environment)
  values (p_org_id, -p_amount, p_reason, p_project_id, p_api_key_id, p_environment);

  insert into public.usage_daily (org_id, day, emails, calls, linkedin, credits)
  values (
    p_org_id,
    current_date,
    case when p_reason = 'email' then 1 else 0 end,
    case when p_reason = 'call' then 1 else 0 end,
    case when p_reason = 'linkedin' then 1 else 0 end,
    p_amount
  )
  on conflict (org_id, day) do update set
    emails = public.usage_daily.emails + excluded.emails,
    calls = public.usage_daily.calls + excluded.calls,
    linkedin = public.usage_daily.linkedin + excluded.linkedin,
    credits = public.usage_daily.credits + excluded.credits;

  return jsonb_build_object('ok', true, 'creditsUsed', p_amount);
end;
$$;
