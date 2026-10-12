-- Every new customer gets a welcome bonus of platform credit (welcome_credit_cents; $10.00 by default, the same
-- number in Canadian dollars for customers in Canada; 0 turns it off), once, when they confirm their email address.
insert into public.settings (key, value) values ('welcome_credit_cents', '1000') on conflict (key) do nothing;

alter table public.profiles add column welcome_credit_at timestamptz;

-- Gives the welcome bonus if the account is a customer that hasn't had it. Returns the amount given (0 if none).
create function public.grant_welcome_credit(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  amount integer := coalesce(public.setting_int('welcome_credit_cents'), 0);
  done uuid;
begin
  if amount <= 0 then
    return 0;
  end if;
  update public.profiles set welcome_credit_at = now()
    where id = p_user and role = 'customer' and status = 'active' and welcome_credit_at is null
    returning id into done;
  if done is null then
    return 0;
  end if;
  insert into public.credit_ledger (user_id, amount_cents, kind, note) values (p_user, amount, 'goodwill', 'Welcome bonus');
  return amount;
end;
$$;
revoke execute on function public.grant_welcome_credit(uuid) from public, anon, authenticated;
grant execute on function public.grant_welcome_credit(uuid) to service_role;
