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
    receipt_no = null,
    edit_count = v_next_edit_count
  where id = v_entry.id;

  return query
  select v_entry.id, null::text, v_next_edit_count;
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

notify pgrst, 'reload schema';
