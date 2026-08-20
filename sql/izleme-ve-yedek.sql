-- ============================================================================
--  ZAMANLANMIŞ İŞ İZLEME + YEDEK PROVASI      ✅ UYGULANDI: 16.08.2026
-- ============================================================================
--  Neden: cron.job_run_details "succeeded" yazıyor ama bu yalnızca SQL'in
--  çalıştığını gösteriyor — net.http_post isteği kuyruğa aldı mı, o kadar.
--  Fonksiyon 500 dönse ya da mail hiç gitmese de "succeeded" görünüyor.
--  Nitekim haftalık özet 10.08'de "succeeded" olmuş, hiçbir mail gitmemişti.
-- ============================================================================

create table if not exists public.zamanli_is_kaydi (
  id bigserial primary key,
  is_adi text not null,
  istek_id bigint,
  baslama timestamptz not null default now(),
  http_durum int,
  sonuc text,
  kontrol_at timestamptz
);
create index if not exists zamanli_is_kaydi_zaman_idx on public.zamanli_is_kaydi (baslama desc);
alter table public.zamanli_is_kaydi enable row level security;
revoke all    on public.zamanli_is_kaydi from anon;
grant  select on public.zamanli_is_kaydi to authenticated;
create policy zamanli_is_oku on public.zamanli_is_kaydi
  for select to authenticated using (public.yonetici_mi());

-- Kontrol edilmemiş çalışmaların GERÇEK HTTP yanıtını işler, başarısızları döner
create or replace function public.zamanli_is_kontrol()
returns table (is_adi text, baslama timestamptz, http_durum int, sonuc text)
language plpgsql security definer set search_path = public, net as $$
begin
  update public.zamanli_is_kaydi k
     set http_durum = r.status_code,
         sonuc = left(coalesce(r.content, r.error_msg, ''), 300),
         kontrol_at = now()
    from net._http_response r
   where r.id = k.istek_id and k.kontrol_at is null
     and k.baslama < now() - interval '3 minutes';

  update public.zamanli_is_kaydi k
     set http_durum = 0, sonuc = 'yanit alinamadi (zaman asimi)', kontrol_at = now()
   where k.kontrol_at is null and k.baslama < now() - interval '30 minutes';

  return query
    select k.is_adi, k.baslama, k.http_durum, k.sonuc
      from public.zamanli_is_kaydi k
     where k.kontrol_at > now() - interval '2 minutes'
       and coalesce(k.http_durum,0) <> 200
     order by k.baslama;
end $$;
revoke execute on function public.zamanli_is_kontrol() from anon, authenticated, public;
grant  execute on function public.zamanli_is_kontrol() to service_role;

-- ── Yedekten geri dönüş provası ─────────────────────────────────────────────
-- Geri yüklenmemiş yedek, yedek sayılmaz. Yedeği AYRI bir şemaya gerçek
-- tablolara yükler ve canlıyla satır sayısı karşılaştırır; üretime dokunmaz.
create schema if not exists yedek_prova;

create or replace function public.yedek_prova_yukle(veri jsonb)
returns table (tablo text, yedekteki int, geri_yuklenen int, canlidaki int)
language plpgsql security definer set search_path = public as $$
declare t text; yuklenen int; canli int;
begin
  for t in select k from jsonb_object_keys(veri) k order by k loop
    continue when jsonb_typeof(veri->t) <> 'array';
    continue when not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relkind='r');

    execute format('drop table if exists yedek_prova.%I', t);
    execute format('create table yedek_prova.%I (like public.%I including defaults)', t, t);
    execute format('insert into yedek_prova.%I select * from jsonb_populate_recordset(null::public.%I, $1)', t, t)
      using veri->t;
    execute format('select count(*) from yedek_prova.%I', t) into yuklenen;
    execute format('select count(*) from public.%I', t) into canli;

    tablo := t; yedekteki := jsonb_array_length(veri->t);
    geri_yuklenen := yuklenen; canlidaki := canli;
    return next;
  end loop;
end $$;
revoke execute on function public.yedek_prova_yukle(jsonb) from anon, authenticated, public;
grant  execute on function public.yedek_prova_yukle(jsonb) to service_role;

-- ── Zamanlanmış işler ───────────────────────────────────────────────────────
--   1  haftalik-yedek   0 21 */2 * *   (2 günde bir, TR gece yarısı)
--   2  haftalik-ozet    0 5 * * 1      (pazartesi 08:00 TR)
--   3  cron-izleme      0 */3 * * *    (3 saatte bir)
-- Her iş istek kimliğini zamanli_is_kaydi'ya yazar; izleme sonradan gerçek
-- HTTP yanıtını işler ve başarısızlık varsa yöneticiye mail atar.
--
-- ⚠ İZLEME NEDEN 3 SAATTE BİR (düzeltme: 20.08.2026)
-- pg_net, HTTP yanıtlarını yalnızca `pg_net.ttl` kadar (bu projede 6 SAAT)
-- saklıyor, sonra siliyor. İzleme günde bir kez 06:00'da çalışıyordu; 21:00'de
-- başlayan yedeğin yanıtına 9 saat sonra bakıyordu ve yanıt çoktan silinmiş
-- oluyordu. Fonksiyon da bunu "yanıt alınamadı (zaman aşımı)" sayıp yöneticiye
-- BAŞARISIZ maili atıyordu — oysa yedek alınmıştı. 19.08'de tam bu oldu;
-- 17.08'de tutmasının sebebi şanstı, pg_net'in temizliği henüz çalışmamıştı.
--
-- 3 saatte bir bakınca en kötü gecikme 3 saat, TTL'in yarısı.
-- Sık çalıştırmak güvenli: zamanli_is_kontrol() yalnızca kontrol_at'i boş
-- satırları işliyor ve yalnızca son 2 dakikada işaretlenenleri raporluyor,
-- yani her iş bir kez denetlenip en fazla bir kez bildiriliyor.
--
-- İşin gerçekten başarılı olduğu ayrıca doğrulandı: yedek-prova en güncel
-- yedeği ayrı bir şemaya geri yükleyip satır sayılarını karşılaştırıyor;
-- 19.08 yedeğinde 19 tablonun tamamında yedekteki = geri yüklenen çıktı.
select cron.alter_job(
  (select jobid from cron.job where jobname='cron-izleme'),
  schedule := '0 */3 * * *'
);
