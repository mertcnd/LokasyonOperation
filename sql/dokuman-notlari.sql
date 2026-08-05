-- Doküman üzerine düşülen notlar (PDF/görsel işaretleme)
-- NOT: Bu betik 2026-08-06'da canlı veritabanına uygulandı; yeniden çalıştırmak
-- gerekmiyor. Dosya, şemanın kod tarafında da izlenebilmesi için tutuluyor.
--
-- Koordinatlar sayfaya göre ORANDIR (0–1 arası), piksel değil. Böylece not,
-- yakınlaştırma seviyesinden ve ekran boyutundan bağımsız olarak hep aynı
-- yerde durur.
--   tip = 'pin'    -> yalnızca x,y kullanılır (numaralı iğne)
--   tip = 'kutu'   -> x,y ile x2,y2 arası dikdörtgen
--   tip = 'ok'     -> x,y başlangıç, x2,y2 ok ucu
--   tip = 'vurgu'  -> x,y ile x2,y2 arası sarı vurgu
--   durum = 'Açık' | 'Çözüldü'

create table if not exists public.dokuman_notlari (
  id text primary key,
  dokuman_id text not null,
  kart_id text,
  sayfa integer not null default 1,
  tip text not null default 'pin',
  x double precision,
  y double precision,
  x2 double precision,
  y2 double precision,
  metin text,
  yazan text,
  tarih text,
  durum text not null default 'Açık'
);

create index if not exists dokuman_notlari_dokuman_idx on public.dokuman_notlari (dokuman_id);
create index if not exists dokuman_notlari_kart_idx on public.dokuman_notlari (kart_id);

-- Diğer tablolarla aynı erişim modeli (anon rolüne tam yetki).
alter table public.dokuman_notlari enable row level security;
drop policy if exists public_all on public.dokuman_notlari;
create policy public_all on public.dokuman_notlari for all to anon using (true) with check (true);

-- Kontrol:
-- select dokuman_id, sayfa, tip, durum, metin from dokuman_notlari order by tarih;
