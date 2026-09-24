-- ---------------------------------------------------------------------------
-- Arşivden geri alma herkese açık — 2026-09-24
--
-- Adım güncellemesi normalde sahibine kilitlidir (`adimlar_guncelle` RLS
-- politikası: yönetici ya da adımın atandığı kişi). Kullanıcı talebiyle
-- ARŞİVDEN GERİ ALMA bu kilitten muaf tutuldu: ekipteki herkes, başkasına
-- atanmış bir adımı da arşivden çıkarabilir.
--
-- Muafiyet dar tutuldu. Genel UPDATE politikası GENİŞLETİLMEDİ; bunun yerine
-- yalnızca `arsivlendi` alanını true'dan false'a çeken security definer bir
-- fonksiyon eklendi. Böylece kilit, adımın diğer bütün alanlarında (durum,
-- atanan, süre, tarih…) aynen sürüyor.
--
-- Marka görünürlüğü korunur: kişi göremediği markanın adımını geri alamaz.
-- ---------------------------------------------------------------------------

create or replace function public.adim_arsivden_cek(
  p_adim_id text default null,
  p_kart_id text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not ekip_mi() then
    raise exception 'Bu işlem için ekip yetkisi gerekir.';
  end if;
  if (p_adim_id is null) = (p_kart_id is null) then
    raise exception 'Adım kimliği veya kart kimliğinden yalnızca biri verilmelidir.';
  end if;

  update public.urun_adimlar a
     set arsivlendi = false
   where coalesce(a.arsivlendi, false)
     and (p_adim_id is null or a.id = p_adim_id)
     and (p_kart_id is null or a.kart_id = p_kart_id)
     and exists (
       select 1 from public.urun_kartlari k
        where k.id = a.kart_id and marka_gorebilir(k.marka)
     );

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.adim_arsivden_cek(text,text) from public, anon;
grant execute on function public.adim_arsivden_cek(text,text) to authenticated;
