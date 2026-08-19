-- ============================================================================
--  PANEL İÇİ BİLDİRİMLER                            ✅ UYGULANDI: 17.08.2026
-- ============================================================================
--  Müşteri bir adımı reddettiğinde (RET), işi yapan kişiye panel üzerinden
--  bildirim düşer. E-posta gönderilmez; bu bilinçli — reddedilen iş ekibin
--  kendi akışında görünmeli, gelen kutusunda değil.
--
--  ALICI kim: reddedilen adımın BİR ÖNCEKİ adımındaki kişi. Müşteri onay
--  adımı bir kontrol noktasıdır; düzeltilecek iş ondan önceki adımda
--  yapılmıştır. Önceki adımda atanan yoksa daha geriye doğru bakılır.
--
--  alici alanı personel ADIDIR (urun_adimlar.atanan ile aynı alan). Panelde
--  atamalar ad üzerinden yürüdüğü için kimlik yerine ad tutuluyor.
-- ============================================================================

create table if not exists public.bildirimler (
  id        text primary key,
  alici     text not null,                       -- personel adı
  tip       text not null default 'musteri_ret',
  baslik    text not null,
  metin     text,
  kart_id   text,
  adim_id   text,
  olusturan text,                                -- bildirimi doğuran kişi
  okundu    boolean not null default false,
  tarih     timestamptz not null default now()
);

create index if not exists bildirimler_alici_idx on public.bildirimler (alici, okundu, tarih desc);

alter table public.bildirimler enable row level security;
revoke all on public.bildirimler from anon;
grant select, update, delete on public.bildirimler to authenticated;

-- Okuma: yalnızca alıcısı. Yönetici hepsini görebilir (destek için).
drop policy if exists bildirim_oku on public.bildirimler;
create policy bildirim_oku on public.bildirimler
  for select to authenticated
  using (alici = public.aktif_personel_adi() or public.yonetici_mi());

-- Güncelleme yalnızca "okundu" işaretlemek için; alıcı kendi satırını
-- başkasına devredemesin diye WITH CHECK de aynı koşulu taşıyor.
drop policy if exists bildirim_guncelle on public.bildirimler;
create policy bildirim_guncelle on public.bildirimler
  for update to authenticated
  using (alici = public.aktif_personel_adi())
  with check (alici = public.aktif_personel_adi());

drop policy if exists bildirim_sil on public.bildirimler;
create policy bildirim_sil on public.bildirimler
  for delete to authenticated
  using (alici = public.aktif_personel_adi() or public.yonetici_mi());

-- INSERT politikası BİLEREK YOK: bildirimi yalnızca musteri-onay Edge
-- Function'ı (service role ile) oluşturur. Panelden kimse kimseye bildirim
-- yazamaz — yazabilseydi bir kullanıcı bir başkası adına sahte bildirim
-- üretebilirdi.
