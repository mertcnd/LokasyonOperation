-- ============================================================================
--  AUTH GEÇİŞİ — satır seviyesi güvenlik (RLS)      ✅ UYGULANDI: 14.08.2026
-- ============================================================================
--  Bu dosya artık tarihsel kayıt ve geri alma kaynağıdır. Uygulanan sıra:
--
--    1. 9 kullanıcı için Auth hesabı açıldı, kullanicilar.auth_uid dolduruldu
--    2. Geçici "köprü" politikası eklendi (authenticated → tam erişim)
--    3. AUTH_MODU = true push edildi — panel Auth'a geçti, veri akmaya devam etti
--    4. Bu dosyadaki politikalar uygulandı; public_all ve köprü kaldırıldı
--
--  Köprü adımı sayesinde kesinti olmadı. Köprüsüz sırada (önce politika, sonra
--  deploy) panel birkaç dakika veri okuyamazdı: public_all yalnızca anon
--  rolüne açıktı, Auth'a geçen kullanıcı authenticated olarak geliyor.
--
--  ── Yol boyunca çıkan iki tuzak ───────────────────────────────────────────
--  · auth.users satırları SQL ile açılırken confirmation_token, recovery_token,
--    email_change, email_change_token_new/current, phone_change,
--    phone_change_token, reauthentication_token alanları NULL bırakılmamalı.
--    Sütunlar NULL kabul ediyor ama GoTrue bunları metin olarak okuduğu için
--    giriş "Database error querying schema" hatası veriyor. Boş metin ('') yaz.
--  · kullanicilar.sifre_hash NOT NULL idi; Auth'ta şifre saklamadığımız için
--    kısıt kaldırıldı ve mevcut hash'ler temizlendi.
-- ============================================================================

-- ─── 1. YARDIMCI FONKSİYONLAR ───────────────────────────────────────────────
-- Hepsi SECURITY DEFINER: politikaların içinden kullanicilar tablosunu
-- okurlar; aksi hâlde politika kendi tablosunu sorgulayıp sonsuz döngüye
-- girerdi (infinite recursion in policy).

create or replace function public.aktif_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.kullanicilar where auth_uid = auth.uid() limit 1
$$;

create or replace function public.aktif_ad()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(ad_soyad,''), kullanici_adi)
  from public.kullanicilar where auth_uid = auth.uid() limit 1
$$;

-- markalar sütunu JSON dizi METNİ tutuyor ('["Bim","Hikmet"]').
-- Bozuk/boş değerde hata vermemesi için biçim önce kontrol edilir.
create or replace function public.aktif_markalar()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select array(select jsonb_array_elements_text(
      case when markalar ~ '^\s*\[' then markalar::jsonb else '[]'::jsonb end))
    from public.kullanicilar where auth_uid = auth.uid() limit 1
  ), '{}'::text[])
$$;

-- coalesce şart: oturum yokken aktif_rol() null döner, "null in (...)" da null
-- verir. RLS null'ı false sayar ama fonksiyonlar başka yerde de kullanılabilir.
create or replace function public.ekip_mi()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.aktif_rol() in ('admin','personel'), false)
$$;

create or replace function public.yonetici_mi()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.aktif_rol() = 'admin', false)
$$;

-- Bu fonksiyonlar yalnızca politikaların içinde kullanılır. RLS ifadeleri
-- sorguyu yapan rolün yetkisiyle çalıştığından authenticated'in EXECUTE
-- yetkisi kalmalı; anon'unki kaldırılır (RPC olarak dışarıdan çağrılmasın).
do $$
declare f text;
begin
  foreach f in array array[
    'public.aktif_rol()','public.aktif_ad()','public.aktif_markalar()',
    'public.ekip_mi()','public.yonetici_mi()',
    'public.marka_gorebilir(text)','public.kart_gorunur(text)'
  ] loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Marka görünürlüğü. Panelde uygulanan kuralın veri tarafındaki karşılığı:
--   admin     → her marka
--   müşteri   → yalnızca kendi markaları (liste boşsa hiçbiri)
--   personel  → liste boşsa kısıt yok, doluysa listedekiler
create or replace function public.marka_gorebilir(m text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.aktif_rol()
    when 'admin'   then true
    when 'musteri' then m = any(public.aktif_markalar())
    when 'personel' then cardinality(public.aktif_markalar()) = 0
                         or m = any(public.aktif_markalar())
    else false
  end
$$;

-- Müşterinin görebileceği kart mı? (Storage politikalarında dosya yolunun
-- ilk parçası kart kimliği olduğu için orada da kullanılır.)
create or replace function public.kart_gorunur(kart text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.urun_kartlari k
    where k.id = kart and public.marka_gorebilir(k.marka)
  )
$$;

-- ─── 2. ESKİ POLİTİKALARI KALDIR ────────────────────────────────────────────
-- Her tabloda anon role tam yetki veren public_all politikası vardı.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists public_all on public.%I', t.tablename);
  end loop;
end $$;

-- ─── 3. YALNIZCA EKİBİN GÖRDÜĞÜ TABLOLAR ────────────────────────────────────
-- Müşteri bu tablolara hiçbir koşulda erişemez: personel adları, maliyetler,
-- izinler, iş yükü, kişisel notlar.
do $$
declare t text;
begin
  foreach t in array array[
    'personeller','is_turleri','gorevler','gorev_notlari','izinler','todos',
    'sim_kayitlar','m_fiyatlar','m_fiyatlar_marka','is_akisi_sablonlari',
    'haftalik_ozet_abonelikleri'
  ] loop
    execute format($f$
      create policy ekip_tum on public.%I
        for all to authenticated
        using (public.ekip_mi()) with check (public.ekip_mi())
    $f$, t);
  end loop;
end $$;

-- ─── 4. MARKALAR ────────────────────────────────────────────────────────────
create policy markalar_oku on public.markalar
  for select to authenticated
  using (public.marka_gorebilir(ad));
create policy markalar_yaz on public.markalar
  for all to authenticated
  using (public.ekip_mi()) with check (public.ekip_mi());

-- ─── 5. ÜRÜN KARTLARI ───────────────────────────────────────────────────────
create policy kartlar_oku on public.urun_kartlari
  for select to authenticated
  using (public.marka_gorebilir(marka));
create policy kartlar_yaz on public.urun_kartlari
  for all to authenticated
  using (public.ekip_mi()) with check (public.ekip_mi());

-- ─── 6. ADIMLAR ─────────────────────────────────────────────────────────────
-- Müşteri adımları görür ama DEĞİŞTİREMEZ. Onay/revizyon işlemini
-- musteri-onay Edge Function'ı servis anahtarıyla yapar; böylece müşterinin
-- yalnızca kendi adımının yalnızca durum alanını değiştirebildiği garanti olur.
create policy adimlar_oku on public.urun_adimlar
  for select to authenticated
  using (exists (select 1 from public.urun_kartlari k
                 where k.id = urun_adimlar.kart_id and public.marka_gorebilir(k.marka)));
-- ── Adım sahipliği (14.08.2026'da eklendi) ──────────────────────────────
-- Bir adıma yalnızca ATANAN kişi müdahale edebilir. Atanmamış adım ekipteki
-- herkese açıktır; aksi hâlde kimse işi üstlenemezdi (116 adım atanmamış).
-- Arayüzdeki karşılığı adimBenimMi(); ikisi birlikte anlam taşır.
create or replace function public.aktif_personel_adi()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.ad,''), nullif(k.ad_soyad,''), k.kullanici_adi)
  from public.kullanicilar k
  left join public.personeller p on p.id = k.personel_id
  where k.auth_uid = auth.uid() limit 1
$$;
revoke execute on function public.aktif_personel_adi() from anon, public;
grant  execute on function public.aktif_personel_adi() to authenticated, service_role;

create policy adimlar_ekle on public.urun_adimlar
  for insert to authenticated
  with check (public.ekip_mi());

create policy adimlar_guncelle on public.urun_adimlar
  for update to authenticated
  using (public.yonetici_mi()
      or (public.ekip_mi() and (coalesce(atanan,'')='' or atanan=public.aktif_personel_adi())))
  with check (public.ekip_mi());

create policy adimlar_sil on public.urun_adimlar
  for delete to authenticated
  using (public.yonetici_mi()
      or (public.ekip_mi() and (coalesce(atanan,'')='' or atanan=public.aktif_personel_adi())));

-- ─── 7. ADIM NOTLARI ────────────────────────────────────────────────────────
-- Müşteri yalnızca KENDİ onay adımlarının notlarını görür; ekibin diğer
-- adımlardaki çalışma notlarını görmez.
create policy adim_notlari_oku on public.urun_adim_notlari
  for select to authenticated
  using (
    public.ekip_mi()
    or exists (
      select 1 from public.urun_adimlar a
        join public.urun_kartlari k on k.id = a.kart_id
      where a.id = urun_adim_notlari.adim_id
        and a.musteri_adimi
        and public.marka_gorebilir(k.marka)
    )
  );
create policy adim_notlari_yaz on public.urun_adim_notlari
  for all to authenticated
  using (public.ekip_mi()) with check (public.ekip_mi());

-- ─── 8. DOKÜMANLAR ──────────────────────────────────────────────────────────
create policy dokuman_oku on public.urun_dokumanlari
  for select to authenticated
  using (exists (select 1 from public.urun_kartlari k
                 where k.id = urun_dokumanlari.kart_id and public.marka_gorebilir(k.marka)));
create policy dokuman_yaz on public.urun_dokumanlari
  for all to authenticated
  using (public.ekip_mi()) with check (public.ekip_mi());

-- ─── 9. DOKÜMAN NOTLARI (işaretlemeler) ─────────────────────────────────────
-- Müşteri kendi işaretlerini görür, ekler, çözüldü işaretler ve siler.
-- Ekibin çalışma notlarını göremez.
create policy dnot_oku on public.dokuman_notlari
  for select to authenticated
  using (
    public.ekip_mi()
    or (yazan = public.aktif_ad()
        and exists (select 1 from public.urun_kartlari k
                    where k.id = dokuman_notlari.kart_id and public.marka_gorebilir(k.marka)))
  );
create policy dnot_ekle on public.dokuman_notlari
  for insert to authenticated
  with check (
    public.ekip_mi()
    or (yazan = public.aktif_ad()
        and exists (select 1 from public.urun_kartlari k
                    where k.id = dokuman_notlari.kart_id and public.marka_gorebilir(k.marka)))
  );
create policy dnot_guncelle on public.dokuman_notlari
  for update to authenticated
  using (public.ekip_mi() or yazan = public.aktif_ad())
  with check (public.ekip_mi() or yazan = public.aktif_ad());
create policy dnot_sil on public.dokuman_notlari
  for delete to authenticated
  using (public.yonetici_mi() or yazan = public.aktif_ad());

-- ─── 10. KULLANICILAR ───────────────────────────────────────────────────────
-- Kimse başkasının kaydını göremez; şifre alanı kimseye açılmaz.
-- Yönetici hepsini görür ve yönetir.
create policy kullanici_kendi on public.kullanicilar
  for select to authenticated
  using (auth_uid = auth.uid() or public.yonetici_mi());
create policy kullanici_yonet on public.kullanicilar
  for all to authenticated
  using (public.yonetici_mi()) with check (public.yonetici_mi());

-- ─── 11. GİRİŞ ÖNCESİ OKUMA ─────────────────────────────────────────────────
-- Auth ile giriş yapılıyor; panelin giriş ekranında artık kullanicilar
-- tablosuna ihtiyaç yok. anon rolüne hiçbir yetki verilmiyor.

-- ============================================================================
--  STORAGE (ayrıca yapılacak)
-- ============================================================================
--  urun-dokumanlari kovası şu an PUBLIC: URL'yi bilen herkes müşteri
--  ambalaj çalışmalarını indirebiliyor. Auth'a geçince kova private yapılıp
--  panel imzalı (süreli) URL kullanmalı:
--
--    update storage.buckets set public = false where id = 'urun-dokumanlari';
--
--    create policy dokuman_oku on storage.objects for select to authenticated
--      using (bucket_id = 'urun-dokumanlari' and public.kart_gorunur(split_part(name,'/',1)));
--    create policy dokuman_yaz on storage.objects for all to authenticated
--      using (bucket_id = 'urun-dokumanlari' and public.ekip_mi())
--      with check (bucket_id = 'urun-dokumanlari' and public.ekip_mi());
--
--  Panel tarafında dnotStorageUrl() ve renderKartDokumanlari() imzalı URL
--  üretecek şekilde güncellenmeli (/storage/v1/object/sign/...).
--  Bu adım geçişten sonra ayrı yapılabilir; kovayı erken kapatmak dokümanları
--  erişilemez hale getirir.

-- ============================================================================
--  GERİ ALMA
-- ============================================================================
--  do $$
--  declare t record;
--  begin
--    for t in select tablename from pg_tables where schemaname='public' loop
--      execute format('drop policy if exists ekip_tum on public.%I', t.tablename);
--      execute format($f$create policy public_all on public.%I
--        for all to anon, authenticated using (true) with check (true)$f$, t.tablename);
--    end loop;
--  end $$;
--  (sonra index.html içinde AUTH_MODU = false)
