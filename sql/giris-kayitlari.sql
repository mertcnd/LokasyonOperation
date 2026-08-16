-- ============================================================================
--  GİRİŞ KAYITLARI                                  ✅ UYGULANDI: 16.08.2026
-- ============================================================================
--  Neden ayrı tablo: Auth doğru bilgiyi tutuyor (auth.sessions → IP, tarayıcı,
--  zaman) ama oturum bitince satır siliniyor; geçmiş kalmıyor.
--
--  ⚠ Barındırılan Supabase'de auth.audit_log_entries YAZILMIYOR (boş).
--    Bu yüzden BAŞARISIZ giriş denemeleri kaydedilemiyor — yalnızca başarılı
--    girişler. "Kimin hesabı zorlanıyor" sorusu bu kurulumla yanıtlanamaz.
-- ============================================================================

create table if not exists public.giris_kayitlari (
  id            bigserial primary key,
  auth_uid      uuid,
  kullanici_adi text,
  ad_soyad      text,
  email         text,
  rol           text,
  giris_at      timestamptz not null default now(),
  ip            text,
  tarayici      text
);
create index if not exists giris_kayitlari_zaman_idx on public.giris_kayitlari (giris_at desc);

alter table public.giris_kayitlari enable row level security;
revoke all    on public.giris_kayitlari from anon;
grant  select on public.giris_kayitlari to authenticated;

-- Yalnızca yönetici okur; yazma trigger üzerinden (security definer).
drop policy if exists giris_kayit_oku on public.giris_kayitlari;
create policy giris_kayit_oku on public.giris_kayitlari
  for select to authenticated using (public.yonetici_mi());

/*
  auth.sessions'a yeni satır düşünce kayıt oluşturur.

  Gövde exception ile sarılı ve bu KASITLI: bu trigger hiçbir koşulda girişi
  engellememeli. GoTrue şeması değişirse kayıt tutulmaz, ama kimse panele
  giremez hale gelmez — sessizce kayıt kaybetmek, herkesi dışarıda bırakmaya
  yeğdir.
*/
create or replace function public.giris_kaydet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.giris_kayitlari (auth_uid, kullanici_adi, ad_soyad, email, rol, giris_at, ip, tarayici)
    select new.user_id, k.kullanici_adi, k.ad_soyad, k.email, k.rol,
           coalesce(new.created_at, now()), host(new.ip), left(new.user_agent, 400)
    from public.kullanicilar k
    where k.auth_uid = new.user_id;

    if not found then   -- profili silinmiş hesap da kayda geçsin
      insert into public.giris_kayitlari (auth_uid, giris_at, ip, tarayici)
      values (new.user_id, coalesce(new.created_at, now()), host(new.ip), left(new.user_agent, 400));
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists giris_kaydi on auth.sessions;
create trigger giris_kaydi after insert on auth.sessions
  for each row execute function public.giris_kaydet();

-- Mevcut oturumlardan geriye dönük doldurma (bir kez)
insert into public.giris_kayitlari (auth_uid, kullanici_adi, ad_soyad, email, rol, giris_at, ip, tarayici)
select s.user_id, k.kullanici_adi, k.ad_soyad, k.email, k.rol,
       s.created_at, host(s.ip), left(s.user_agent, 400)
from auth.sessions s
left join public.kullanicilar k on k.auth_uid = s.user_id;

-- ── Şu an açık oturumlar ────────────────────────────────────────────────────
-- auth şeması PostgREST'e kapalı; panele fonksiyon üzerinden açılıyor.
-- Yönetici değilse sorgu boş döner (WHERE içindeki yonetici_mi()).
create or replace function public.aktif_oturumlar()
returns table (
  kullanici_adi text, ad_soyad text, email text, rol text,
  baslangic timestamptz, son_etkinlik timestamptz, ip text, tarayici text
)
language sql stable security definer set search_path = public as $$
  select k.kullanici_adi, k.ad_soyad, k.email, k.rol,
         s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at),
         host(s.ip), left(s.user_agent, 400)
  from auth.sessions s
  left join public.kullanicilar k on k.auth_uid = s.user_id
  where public.yonetici_mi()
    and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
$$;
revoke execute on function public.aktif_oturumlar() from anon, public;
grant  execute on function public.aktif_oturumlar() to authenticated;
