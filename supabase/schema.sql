-- 团队时段标记：建表 + 索引 + 行级安全策略
-- 在 Supabase Dashboard → SQL Editor 中执行本文件

-- 1. 标记表
create table if not exists public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key text not null,
  day_index int not null check (day_index between 0 and 6),
  slot_index int not null check (slot_index between 0 and 3),
  nickname text not null,
  location text not null,
  created_at timestamptz not null default now()
);

comment on table public.marks is '用户对某周某天某时段的标记';
comment on column public.marks.week_key is '该周周一日期，格式 YYYY-MM-DD';
comment on column public.marks.day_index is '0=周一 ... 6=周日';
comment on column public.marks.slot_index is '0=12点前 1=12-15 2=15-18 3=18点后';

-- 2. 索引：按周查询、按格子查询、按用户查询
create index if not exists marks_week_key_idx
  on public.marks (week_key);

create index if not exists marks_week_cell_idx
  on public.marks (week_key, day_index, slot_index);

create index if not exists marks_user_id_idx
  on public.marks (user_id);

-- 3. 开启行级安全
alter table public.marks enable row level security;

-- 4. 已登录用户可读全部记录
create policy "已登录用户可读取全部标记"
  on public.marks
  for select
  to authenticated
  using (true);

-- 5. 用户只能插入自己的记录
create policy "用户只能插入自己的标记"
  on public.marks
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- 6. 用户只能删除自己的记录（本需求不开放 UPDATE）
create policy "用户只能删除自己的标记"
  on public.marks
  for delete
  to authenticated
  using (user_id = auth.uid());
