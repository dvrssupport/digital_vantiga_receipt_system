drop index if exists public.unique_reference_per_sabha_fy;

create index if not exists idx_reference_per_sabha_fy
on public.vantiga_entries using btree (sabha_id, fy, paid_by, reference_no)
tablespace pg_default
where (
  reference_no is not null
  and reference_no <> ''::text
  and (
    paid_by = any (
      array[
        'Cheque'::paid_by,
        'NEFT/RTGS/IMPS'::paid_by,
        'Online'::paid_by,
        'UPI'::paid_by
      ]
    )
  )
);
