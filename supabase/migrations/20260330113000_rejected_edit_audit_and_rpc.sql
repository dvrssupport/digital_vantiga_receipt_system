alter table public.vantiga_entries
add column if not exists edit_count integer not null default 0;

alter table public.vantiga_entries
add column if not exists receipt_base_no text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vantiga_entries_edit_count_range_check'
  ) then
    alter table public.vantiga_entries
    add constraint vantiga_entries_edit_count_range_check
    check (edit_count >= 0 and edit_count <= 2);
  end if;
end $$;

create table if not exists public.vantiga_entry_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vantiga_entries(id) on delete cascade,
  event_type text not null check (event_type in ('REJECTED', 'EDIT_SUBMITTED', 'RECEIPT_ASSIGNED')),
  edit_iteration integer not null default 0,
  old_status public.entry_status,
  new_status public.entry_status,
  old_receipt_no text,
  new_receipt_no text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role public.app_role,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vantiga_entry_audit_entry_created_idx
  on public.vantiga_entry_audit(entry_id, created_at desc);

grant select on public.vantiga_entry_audit to authenticated;

create or replace function public.block_entry_edits()
returns trigger
language plpgsql
as $$
begin
  if (
    tg_op = 'UPDATE'
    and coalesce(current_setting('app.allow_rejected_entry_edit', true), 'off') = 'on'
  ) then
    return new;
  end if;

  if (
    tg_op = 'UPDATE'
    and new.status = 'REJECTED'
    and old.status is distinct from new.status
    and coalesce(old.receipt_no, '') <> ''
    and coalesce(new.receipt_base_no, '') = ''
  ) then
    new.receipt_base_no := old.receipt_no;
  end if;

  if (tg_op = 'UPDATE') then
    if (
      new.sabha_id <> old.sabha_id or
      new.family_id <> old.family_id or
      new.fy <> old.fy or
      new.paid_by <> old.paid_by or
      coalesce(new.reference_no,'') <> coalesce(old.reference_no,'') or
      new.submitted_by <> old.submitted_by or
      new.submitted_at <> old.submitted_at
    ) then
      raise exception 'Edits to submitted entry data are not allowed.';
    end if;
  end if;

  return new;
end $$;

create or replace function public.resolve_actor_role(
  p_user_id uuid,
  p_sabha_id uuid
)
returns public.app_role
language sql
stable
as $$
  select usr.role
  from public.user_sabha_roles usr
  where usr.user_id = p_user_id
    and usr.sabha_id = p_sabha_id
    and usr.is_active = true
  order by case usr.role
    when 'treasurer' then 1
    when 'pratinidhi' then 2
    when 'auditor' then 3
    when 'scm_office' then 4
    else 5
  end
  limit 1;
$$;

create or replace function public.record_vantiga_entry_audit()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
begin
  v_role := public.resolve_actor_role(v_actor, new.sabha_id);

  if tg_op = 'INSERT' then
    if coalesce(new.receipt_no, '') <> '' then
      insert into public.vantiga_entry_audit (
        entry_id,
        event_type,
        edit_iteration,
        old_status,
        new_status,
        old_receipt_no,
        new_receipt_no,
        actor_user_id,
        actor_role,
        reason,
        snapshot
      )
      values (
        new.id,
        'RECEIPT_ASSIGNED',
        coalesce(new.edit_count, 0),
        new.status,
        new.status,
        null,
        new.receipt_no,
        v_actor,
        v_role,
        null,
        jsonb_build_object(
          'fy', new.fy,
          'paid_by', new.paid_by
        )
      );
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'REJECTED' then
    insert into public.vantiga_entry_audit (
      entry_id,
      event_type,
      edit_iteration,
      old_status,
      new_status,
      old_receipt_no,
      new_receipt_no,
      actor_user_id,
      actor_role,
      reason,
      snapshot
    )
    values (
      new.id,
      'REJECTED',
      coalesce(new.edit_count, 0),
      old.status,
      new.status,
      old.receipt_no,
      new.receipt_no,
      v_actor,
      v_role,
      new.rejection_reason,
      jsonb_build_object(
        'paid_by', new.paid_by,
        'reference_no', coalesce(new.reference_no, '')
      )
    );
  end if;

  if (
    old.status = 'REJECTED'
    and new.status = 'SUBMITTED'
    and coalesce(new.edit_count, 0) > coalesce(old.edit_count, 0)
  ) then
    insert into public.vantiga_entry_audit (
      entry_id,
      event_type,
      edit_iteration,
      old_status,
      new_status,
      old_receipt_no,
      new_receipt_no,
      actor_user_id,
      actor_role,
      reason,
      snapshot
    )
    values (
      new.id,
      'EDIT_SUBMITTED',
      new.edit_count,
      old.status,
      new.status,
      old.receipt_no,
      new.receipt_no,
      v_actor,
      v_role,
      null,
      jsonb_build_object(
        'fy', new.fy,
        'entry_type', new.entry_type,
        'paid_by', new.paid_by,
        'reference_no', coalesce(new.reference_no, '')
      )
    );
  end if;

  if (
    coalesce(new.receipt_no, '') <> ''
    and coalesce(old.receipt_no, '') <> coalesce(new.receipt_no, '')
  ) then
    insert into public.vantiga_entry_audit (
      entry_id,
      event_type,
      edit_iteration,
      old_status,
      new_status,
      old_receipt_no,
      new_receipt_no,
      actor_user_id,
      actor_role,
      reason,
      snapshot
    )
    values (
      new.id,
      'RECEIPT_ASSIGNED',
      coalesce(new.edit_count, 0),
      old.status,
      new.status,
      old.receipt_no,
      new.receipt_no,
      v_actor,
      v_role,
      null,
      jsonb_build_object(
        'fy', new.fy,
        'paid_by', new.paid_by
      )
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_record_vantiga_entry_audit on public.vantiga_entries;
create trigger trg_record_vantiga_entry_audit
after insert or update on public.vantiga_entries
for each row
execute function public.record_vantiga_entry_audit();

create or replace function public.edit_rejected_vantiga_entry(
  p_entry_id uuid,
  p_fy text,
  p_entry_type text,
  p_paid_by public.paid_by,
  p_reference_no text,
  p_remarks text,
  p_address_multiline text,
  p_payer_mobile text,
  p_payer_email text,
  p_opt_show_amount_in_directory boolean,
  p_opt_show_mobile_in_directory boolean,
  p_opt_show_email_in_directory boolean,
  p_members jsonb
)
returns table (
  entry_id uuid,
  receipt_no text,
  edit_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_can_edit boolean := false;
  v_entry public.vantiga_entries%rowtype;
  v_next_edit_count integer;
  v_receipt_code text;
  v_seq integer;
  v_next_receipt_no text;
  v_member jsonb;
begin
  if v_actor is null then
    raise exception 'No active session. Please login again.';
  end if;

  select *
  into v_entry
  from public.vantiga_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Entry not found.';
  end if;

  select exists (
    select 1
    from public.user_sabha_roles usr
    where usr.user_id = v_actor
      and usr.sabha_id = v_entry.sabha_id
      and usr.is_active = true
      and (
        usr.role = 'treasurer'
        or (usr.role = 'pratinidhi' and v_entry.submitted_by = v_actor)
      )
  )
  into v_actor_can_edit;

  if not v_actor_can_edit then
    raise exception 'You are not allowed to edit this rejected entry.';
  end if;

  if v_entry.status <> 'REJECTED' then
    raise exception 'Only rejected entries can be edited.';
  end if;

  if coalesce(v_entry.edit_count, 0) >= 2 then
    raise exception 'Maximum edit limit reached for this entry.';
  end if;

  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    raise exception 'At least one member is required.';
  end if;

  if jsonb_array_length(p_members) > 4 then
    raise exception 'A maximum of 4 members is allowed.';
  end if;

  if p_paid_by <> 'Cash' and coalesce(btrim(p_reference_no), '') = '' then
    raise exception 'Reference number is required for non-cash payments.';
  end if;

  perform set_config('app.allow_rejected_entry_edit', 'on', true);

  update public.families
  set
    address_multiline = p_address_multiline,
    payer_mobile = p_payer_mobile,
    payer_email = p_payer_email,
    opt_show_amount_in_directory = coalesce(p_opt_show_amount_in_directory, false),
    opt_show_mobile_in_directory = coalesce(p_opt_show_mobile_in_directory, false),
    opt_show_email_in_directory = coalesce(p_opt_show_email_in_directory, false)
  where id = v_entry.family_id;

  delete from public.family_members where family_id = v_entry.family_id;

  for v_member in select value from jsonb_array_elements(p_members)
  loop
    insert into public.family_members (
      family_id,
      full_name,
      age,
      gender,
      gotra,
      other_gotra,
      is_married,
      maiden_surname,
      amount,
      is_primary_payer
    )
    values (
      v_entry.family_id,
      coalesce(v_member->>'full_name', ''),
      nullif(v_member->>'age', '')::integer,
      coalesce(v_member->>'gender', 'Male')::public.gender,
      nullif(v_member->>'gotra', ''),
      nullif(v_member->>'other_gotra', ''),
      coalesce((v_member->>'is_married')::boolean, false),
      nullif(v_member->>'maiden_surname', ''),
      coalesce(nullif(v_member->>'amount', ''), '0')::numeric(12,2),
      coalesce((v_member->>'is_primary_payer')::boolean, false)
    );
  end loop;

  v_next_edit_count := coalesce(v_entry.edit_count, 0) + 1;
  v_next_receipt_no := null;

  if coalesce(v_entry.receipt_base_no, '') <> '' then
    -- Keep base receipt visible at resubmission; suffix is finalized at treasurer acknowledgement.
    v_next_receipt_no := v_entry.receipt_base_no;
  elsif p_paid_by = 'Cash' then
    select coalesce(s.receipt_code, s.code, 'SABHA')
    into v_receipt_code
    from public.sabhas s
    where s.id = v_entry.sabha_id;

    select coalesce(count(*), 0) + 1
    into v_seq
    from public.vantiga_entries ve
    where ve.sabha_id = v_entry.sabha_id
      and ve.fy = p_fy
      and ve.receipt_no is not null;

    v_next_receipt_no := coalesce(v_receipt_code, 'SABHA') || '-' || lpad(v_seq::text, 4, '0');
  end if;

  update public.vantiga_entries
  set
    fy = p_fy,
    entry_type = p_entry_type,
    paid_by = p_paid_by,
    reference_no = case when p_paid_by = 'Cash' then null else nullif(btrim(p_reference_no), '') end,
    remarks = nullif(btrim(p_remarks), ''),
    status = 'SUBMITTED',
    rejection_reason = null,
    submitted_at = now(),
    acknowledged_by = null,
    acknowledged_at = null,
    receipt_no = v_next_receipt_no,
    edit_count = v_next_edit_count
  where id = v_entry.id;

  return query
  select v_entry.id, v_next_receipt_no, v_next_edit_count;
end;
$$;

grant execute on function public.edit_rejected_vantiga_entry(
  uuid,
  text,
  text,
  public.paid_by,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  jsonb
) to authenticated;
