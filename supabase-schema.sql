create table if not exists public.articles (
  source_url text primary key,
  title text not null,
  summary text not null default '',
  article text not null,
  category text not null default 'AI',
  published_at timestamptz not null default now(),
  source text not null default 'News desk',
  score integer not null check (score between 1 and 10),
  created_at timestamptz not null default now()
);

alter table public.articles enable row level security;
grant select on public.articles to anon, authenticated;

drop policy if exists "Anyone can read published articles" on public.articles;
create policy "Anyone can read published articles"
  on public.articles
  for select
  to anon, authenticated
  using (true);
