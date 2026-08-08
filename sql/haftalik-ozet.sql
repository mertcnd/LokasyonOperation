-- Haftalık marka özeti (otomatik e-posta)
-- NOT: Bu betik ve cron tanımı 2026-08-06'da canlı veritabanına uygulandı;
-- yeniden çalıştırmak gerekmiyor. Şemanın kodda izlenebilmesi için tutuluyor.
--
-- Gönderimi Supabase Edge Function "haftalik-ozet" yapar
-- (kaynak: supabase/functions/haftalik-ozet/index.ts).
-- Tetikleyici: pg_cron — her pazartesi 05:00 UTC = 08:00 TR.

create table if not exists public.haftalik_ozet_abonelikleri (
  id text primary key,
  marka text not null,
  alici_ad text,
  alici_email text not null,
  aktif boolean not null default true,
  son_gonderim timestamptz,
  olusturan text,
  olusturma_tarihi text
);

create index if not exists haftalik_ozet_marka_idx on public.haftalik_ozet_abonelikleri (marka);

alter table public.haftalik_ozet_abonelikleri enable row level security;
drop policy if exists public_all on public.haftalik_ozet_abonelikleri;
create policy public_all on public.haftalik_ozet_abonelikleri for all to anon using (true) with check (true);

-- Zamanlanmış görev (pg_cron ve pg_net eklentileri projede kurulu):
-- select cron.schedule(
--   'haftalik-ozet-pazartesi',
--   '0 5 * * 1',
--   $$ select net.http_post(
--        url := 'https://wimqfhjyflraorytlnsl.supabase.co/functions/v1/haftalik-ozet',
--        headers := '{"Content-Type":"application/json"}'::jsonb,
--        body := '{}'::jsonb
--      ); $$
-- );
--
-- Kontrol:  select jobid, jobname, schedule, active from cron.job;
-- Durdurma: select cron.alter_job((select jobid from cron.job where jobname='haftalik-ozet-pazartesi'), active := false);
