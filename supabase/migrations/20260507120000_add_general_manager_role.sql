do $$
begin
  alter type public.app_role add value if not exists 'general_manager';
exception
  when duplicate_object then null;
end $$;
