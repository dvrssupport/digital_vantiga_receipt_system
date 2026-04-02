create or replace function public.enqueue_submission_ack_email_dispatch()
returns trigger
language plpgsql
as $$
declare
  v_payer_email text;
  v_submitted_at timestamptz;
begin
  if new.status <> 'SUBMITTED' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.submitted_at, 'epoch'::timestamptz) = coalesce(new.submitted_at, 'epoch'::timestamptz)
      and old.status is not distinct from new.status
      and old.paid_by is not distinct from new.paid_by then
      return new;
    end if;
  end if;

  select f.payer_email
    into v_payer_email
  from public.families f
  where f.id = new.family_id;

  if coalesce(btrim(v_payer_email), '') = '' then
    return new;
  end if;

  v_submitted_at := coalesce(new.submitted_at, now());

  insert into public.submission_ack_email_dispatch (
    entry_id,
    submitted_at,
    payer_email,
    paid_by,
    status,
    attempt_count
  )
  values (
    new.id,
    v_submitted_at,
    v_payer_email,
    new.paid_by::text,
    'pending',
    0
  )
  on conflict (entry_id, submitted_at) do nothing;

  return new;
end;
$$;
