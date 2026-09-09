-- Bekleyen müşteri onayının yanlış dosya nedeniyle geri çekilebilmesi.
-- 2026-09-09 tarihinde workflow-v2.sql sonrasında uygulanır.
begin;

alter table public.onay_paketleri add column if not exists geri_cekildi timestamptz;
alter table public.onay_paketleri add column if not exists geri_ceken text;
alter table public.onay_paketleri add column if not exists geri_cekme_nedeni text;
alter table public.onay_paketleri drop constraint if exists onay_paketleri_durum_check;
alter table public.onay_paketleri add constraint onay_paketleri_durum_check
  check(durum in ('Bekliyor','Onaylandı','Revizyon','Geri Çekildi'));

create or replace function public.wf_dokuman_koru() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(
   select 1 from public.onay_paketleri p
   cross join lateral jsonb_array_elements(p.dosyalar) d
   where p.durum<>'Geri Çekildi' and d->>'id'=old.id
 ) then
   raise exception 'Dosya bekleyen veya sonuçlanmış bir onay paketinde kullanılıyor.';
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;

create or replace function public.wf_dosya_kilitli(yol text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from public.onay_paketleri p
   cross join lateral jsonb_array_elements(p.dosyalar) d
   where p.durum<>'Geri Çekildi' and d->>'dosya_yolu'=yol
 )
$$;

create or replace function public.workflow_onay_geri_cek(
  p_adim_id text,
  p_paket_id text,
  p_neden text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 a public.urun_adimlar%rowtype;
 p public.onay_paketleri%rowtype;
 kart text;
 rol text;
 neden text;
 not_id text;
begin
 rol=public.aktif_rol();
 neden=trim(coalesce(p_neden,''));
 if auth.uid() is null or rol not in ('admin','personel') then
   raise exception 'Bu işlem yalnızca ekip içindir.';
 end if;
 select kart_id into kart from public.urun_adimlar where id=p_adim_id;
 if kart is null or not coalesce(public.kart_gorunur(kart),false) then
   raise exception 'Bu karta erişiminiz yok.';
 end if;
 perform 1 from public.urun_kartlari where id=kart for update;
 select * into a from public.urun_adimlar where id=p_adim_id for update;
 if coalesce(a.arsivlendi,false) or not a.musteri_adimi then
   raise exception 'Geçerli bir müşteri onay adımı seçin.';
 end if;
 if rol<>'admin' and coalesce(a.atanan,'')<>''
   and a.atanan<>public.aktif_personel_adi() then
   raise exception 'Bu adım size atanmamış.';
 end if;
 if neden='' then raise exception 'Geri çekme nedeni zorunlu.'; end if;
 select * into p from public.onay_paketleri
   where id=p_paket_id and adim_id=a.id and durum='Bekliyor'
   for update;
 if not found then
   raise exception 'Bu onay isteği artık beklemiyor. Sayfayı yenileyin.';
 end if;
 update public.onay_paketleri
   set durum='Geri Çekildi',
       geri_cekildi=now(),
       geri_ceken=public.aktif_ad(),
       geri_cekme_nedeni=neden
   where id=p.id
   returning * into p;
 update public.urun_adimlar set durum='RET' where id=a.id;
 not_id=gen_random_uuid()::text;
 insert into public.urun_adim_notlari(id,adim_id,metin,yazan,tarih)
   values(
     not_id,
     a.id,
     'Tur '||p.tur||' — Ekip tarafından geri çekildi: '||neden,
     public.aktif_ad(),
     current_date
   );
 return to_jsonb(p);
end $$;

revoke all on function public.workflow_onay_geri_cek(text,text,text) from public,anon;
grant execute on function public.workflow_onay_geri_cek(text,text,text) to authenticated;
revoke all on function public.wf_dokuman_koru(),public.wf_dosya_kilitli(text)
  from public,anon;
grant execute on function public.wf_dosya_kilitli(text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
