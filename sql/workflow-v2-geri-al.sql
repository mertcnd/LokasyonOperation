-- ---------------------------------------------------------------------------
-- İş akışı v2'nin geri alınması — 2026-09-24
--
-- Kaldırılan davranışlar (kullanıcı kararı): adım ön koşulları, sürümlü dosya
-- onay paketleri, otomatik revizyon turu ve bekleyen onayı geri çekme.
-- Panel, 2026-09-09 öncesindeki sıra numarası tabanlı akışa döndü.
--
-- Uygulama öncesi sayım: 0 onay paketi, 0 revizyon turu, 246 adımın hiçbirinde
-- tanımlı bağımlılık. Yani silinen müşteri onay geçmişi yok.
--
-- Bu betik, sql/workflow-v2.sql ve sql/workflow-v2-onay-geri-cek.sql ile
-- kurulan HER nesneyi adıyla düşürür; başka göçlerin nesnelerine dokunmaz.
-- ---------------------------------------------------------------------------

-- 1) Storage'daki daraltıcı kurallar. Önce bunlar kalkmalı; yoksa dosya silme
--    wf_dosya_kilitli() düşürüldüğünde hata verir.
drop policy if exists wf_storage_silme on storage.objects;
drop policy if exists wf_storage_degistirme on storage.objects;

-- 2) Koruma tetikleyicileri
drop trigger if exists wf_adim_koru on public.urun_adimlar;
drop trigger if exists wf_dokuman_koru on public.urun_dokumanlari;

-- 3) İşlemler ve yardımcı fonksiyonlar
drop function if exists public.workflow_v2(text,jsonb);
drop function if exists public.workflow_onay_geri_cek(text,text,text);
drop function if exists public.wf_adim_koru();
drop function if exists public.wf_dokuman_koru();
drop function if exists public.wf_dosya_kilitli(text);
drop function if exists public.wf_engeller(text);

-- 4) Tablolar (RLS politikaları, indeksler ve grant'lar birlikte gider).
--    revizyon_turlari, onay_paketleri'ne referans verdiği için önce o düşer.
drop table if exists public.revizyon_turlari;
drop table if exists public.onay_paketleri;

-- 5) Akış kolonları
drop index if exists public.dokuman_seri_surum;
alter table public.urun_adimlar
  drop column if exists wf_bagimliliklar,
  drop column if exists wf_basladi,
  drop column if exists wf_tamamlandi,
  drop column if exists wf_teslim_hedefi;
alter table public.urun_dokumanlari
  drop column if exists wf_seri,
  drop column if exists wf_surum;
