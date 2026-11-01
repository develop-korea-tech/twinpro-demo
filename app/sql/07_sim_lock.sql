-- 자동 재생은 한 화면만: 재생 중인 화면이 15초마다 잠금을 갱신하고, 다른 화면은 잠금이 살아 있는 동안 재생을 시작할 수 없다.
create table if not exists tp_sim_lock (id int primary key default 1 check (id = 1), owner text not null, until timestamptz not null);

create or replace function tp_sim_claim(p_owner text) returns json language plpgsql security definer as $$
declare o text;
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다. 오른쪽 위 [조작 권한 받기]에서 입력하세요.'); end if;
  if coalesce(trim(p_owner), '') = '' then return tp_res(false, '화면 식별값이 없습니다.'); end if;
  insert into tp_sim_lock as l (id, owner, until) values (1, p_owner, now() + interval '15 seconds')
    on conflict (id) do update set owner = excluded.owner, until = excluded.until where l.owner = excluded.owner or l.until < now()
    returning owner into o;
  if o is null then return tp_res(false, '다른 화면에서 자동 재생 중입니다. 그 화면에서 멈춘 뒤 다시 시도하세요.'); end if;
  return tp_res(true, '');
end $$;

create or replace function tp_sim_release(p_owner text) returns json language plpgsql security definer as $$
begin
  if not tp_code_ok() then return tp_res(false, '시연 코드가 필요합니다.'); end if;
  update tp_sim_lock set until = now() - interval '1 second' where id = 1 and owner = p_owner;
  return tp_res(true, '');
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tp\_sim\_%' loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
