-- Lokasyon workflow v2 — 2026-09-09. Yeni migration; uygulanma kaydı docs/workflow-v2.md.
-- Tek transaction. Eski kayıtların tarihleri/onayları tahmin edilmez.
begin;
alter table public.urun_adimlar add column if not exists wf_bagimliliklar jsonb not null default '[]';
alter table public.urun_adimlar add column if not exists wf_basladi timestamptz;
alter table public.urun_adimlar add column if not exists wf_tamamlandi timestamptz;
alter table public.urun_adimlar add column if not exists wf_teslim_hedefi date;
alter table public.urun_dokumanlari add column if not exists wf_seri text;
alter table public.urun_dokumanlari add column if not exists wf_surum integer not null default 1;
-- Mevcut dosyalar ayrı serilerdir: ada bakarak yanlış sürüm ilişkisi kurulmaz.
update public.urun_dokumanlari set wf_seri=id where wf_seri is null;
create unique index if not exists dokuman_seri_surum on public.urun_dokumanlari(wf_seri,wf_surum);

create table if not exists public.onay_paketleri (
 id text primary key default gen_random_uuid()::text,
 kart_id text not null references public.urun_kartlari(id),
 adim_id text not null references public.urun_adimlar(id),
 tur integer not null, dosyalar jsonb not null,
 durum text not null default 'Bekliyor' constraint onay_paketleri_durum_check
   check(durum in ('Bekliyor','Onaylandı','Revizyon','Geri Çekildi')),
 sunuldu timestamptz not null default now(), karar_zamani timestamptz,
 karar_veren text, aciklama text,
 geri_cekildi timestamptz, geri_ceken text, geri_cekme_nedeni text,
 duzeltme_adim_id text not null references public.urun_adimlar(id),
 revizyon_hedefi date not null,
 unique(adim_id,tur)
);
create unique index if not exists tek_acik_onay on public.onay_paketleri(adim_id) where durum='Bekliyor';
create table if not exists public.revizyon_turlari (
 id text primary key default gen_random_uuid()::text,
 kart_id text not null references public.urun_kartlari(id),
 paket_id text not null unique references public.onay_paketleri(id),
 onay_adim_id text not null references public.urun_adimlar(id),
 uretim_adim_id text not null references public.urun_adimlar(id),
 sorumlu text not null, hedef_tarih date not null, aciklama text not null,
 acildi timestamptz not null default now(), yeniden_sunuldu timestamptz,
 baslangic_dk numeric not null default 0, harcanan_dk numeric
);
create unique index if not exists tek_acik_duzeltme on public.revizyon_turlari(uretim_adim_id) where yeniden_sunuldu is null;

alter table public.onay_paketleri enable row level security;
alter table public.revizyon_turlari enable row level security;
revoke all on public.onay_paketleri,public.revizyon_turlari from public,anon,authenticated;
grant select on public.onay_paketleri,public.revizyon_turlari to authenticated;
create policy onay_paketi_oku on public.onay_paketleri for select to authenticated
 using(public.kart_gorunur(kart_id));
create policy revizyon_turu_oku on public.revizyon_turlari for select to authenticated
 using(public.ekip_mi() and public.kart_gorunur(kart_id));

-- Döngü kontrolü: yalnızca aynı karttaki, arşivlenmemiş adımlar seçilebilir.
create or replace function public.wf_engeller(adim text) returns text[]
language sql stable security definer set search_path=public as $$
 select coalesce(array_agg(coalesce(b.ad,'Silinmiş bağımlılık')),array[]::text[])
 from public.urun_adimlar a cross join lateral jsonb_array_elements_text(a.wf_bagimliliklar) x(id)
 left join public.urun_adimlar b on b.id=x.id and b.kart_id=a.kart_id
 where a.id=adim and (b.id is null or b.durum is distinct from 'Tamamlandı' or coalesce(b.arsivlendi,false))
$$;

-- Durum, tarih ve onay tutarlılığı eski panel/PATCH yolunda da korunur.
create or replace function public.wf_adim_koru() returns trigger
language plpgsql set search_path=public as $$
begin
 if TG_OP='DELETE' then
   if exists(select 1 from public.urun_adimlar a where a.wf_bagimliliklar ? old.id) then
     raise exception 'Bu adıma bağlı işler var; önce bağımlılıkları düzenleyin.';
   end if;
   return old;
 end if;
 if current_user in ('authenticated','anon') then
   if new.wf_bagimliliklar is distinct from old.wf_bagimliliklar
     or new.wf_tamamlandi is distinct from old.wf_tamamlandi
     or new.wf_basladi is distinct from old.wf_basladi
     or new.wf_teslim_hedefi is distinct from old.wf_teslim_hedefi then
     raise exception 'Akış alanları yalnızca akış işlemiyle değiştirilebilir.';
   end if;
   if old.musteri_adimi and new.durum is distinct from old.durum then
     raise exception 'Müşteri adımını dosyaları onaya sunarak ilerletin.';
   end if;
 end if;
 if (new.musteri_adimi is distinct from old.musteri_adimi or new.kart_id is distinct from old.kart_id)
   and exists(select 1 from public.onay_paketleri where adim_id=old.id) then
   raise exception 'Onay geçmişi bulunan adımın türü veya kartı değiştirilemez.';
 end if;
 if new.arsivlendi and not coalesce(old.arsivlendi,false) and (
   exists(select 1 from public.urun_adimlar a where a.wf_bagimliliklar ? old.id and not coalesce(a.arsivlendi,false) and a.durum<>'Tamamlandı')
   or exists(select 1 from public.onay_paketleri where adim_id=old.id and durum='Bekliyor')
   or exists(select 1 from public.revizyon_turlari where (uretim_adim_id=old.id or onay_adim_id=old.id) and yeniden_sunuldu is null)
 ) then raise exception 'Bekleyen bağlı iş, onay veya revizyon varken adım arşivlenemez.'; end if;
 if exists(select 1 from public.revizyon_turlari r where r.uretim_adim_id=old.id and r.yeniden_sunuldu is null
   and coalesce(new.gercek_sure,0)<r.baslangic_dk) then
   raise exception 'Fiili süre açık revizyonun başlangıç toplamından küçük olamaz.';
 end if;
 if new.durum is distinct from old.durum then
   if new.durum in ('Devam Ediyor','Tamamlandı') and cardinality(public.wf_engeller(old.id))>0 then
     raise exception 'Önce bağlı adımları tamamlayın: %',array_to_string(public.wf_engeller(old.id),', ');
   end if;
   if new.durum='Devam Ediyor' then new.wf_basladi=coalesce(old.wf_basladi,now()); end if;
   if new.durum='Tamamlandı' then
     new.wf_tamamlandi=now(); new.wf_teslim_hedefi=nullif(new.tarih,'')::date;
   else new.wf_tamamlandi=null; new.wf_teslim_hedefi=null; end if;
 end if;
 return new;
end $$;
create trigger wf_adim_koru before update or delete on public.urun_adimlar
 for each row execute function public.wf_adim_koru();

create or replace function public.wf_dokuman_koru() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.onay_paketleri p cross join lateral jsonb_array_elements(p.dosyalar) d
   where p.durum<>'Geri Çekildi' and d->>'id'=old.id) then
   raise exception 'Onaya sunulan dosya değiştirilemez veya silinemez. Yeni sürüm yükleyin.';
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger wf_dokuman_koru before update or delete on public.urun_dokumanlari
 for each row execute function public.wf_dokuman_koru();
create or replace function public.wf_dosya_kilitli(yol text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.onay_paketleri p cross join lateral jsonb_array_elements(p.dosyalar) d
 where p.durum<>'Geri Çekildi' and d->>'dosya_yolu'=yol)
$$;
-- Var olan izinlere ek, daraltıcı kurallar. Onaylı fiziksel dosya da korunur.
create policy wf_storage_silme on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'urun-dokumanlari' or not public.wf_dosya_kilitli(name));
create policy wf_storage_degistirme on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'urun-dokumanlari' or not public.wf_dosya_kilitli(name))
 with check(bucket_id<>'urun-dokumanlari' or not public.wf_dosya_kilitli(name));

-- Tüm kritik işlemler kart kilidi altında atomik. Eski sekmelerin kararı
-- paket kimliğiyle reddedilir; aynı onay iki kez işlenemez.
create or replace function public.workflow_v2(islem text, veri jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 a public.urun_adimlar%rowtype; hedef public.urun_adimlar%rowtype;
 p public.onay_paketleri%rowtype; r public.revizyon_turlari%rowtype;
 d public.urun_dokumanlari%rowtype; onceki public.urun_dokumanlari%rowtype;
 kart text; rol text; bag jsonb; snap jsonb; sec text[]; kid text;
 tur_no integer; s_no integer; seri text; v_karar text; v_aciklama text; not_id text;
 hedef_tarih date; yeni_durum text; engel text[]; path text;
begin
 rol=public.aktif_rol();
 if auth.uid() is null or rol is null then raise exception 'Geçerli oturum gerekli.'; end if;
 if islem='surum' then return jsonb_build_object('surum',2); end if;
 if islem='dokuman' then kart=veri->>'kart_id';
 else select kart_id into kart from public.urun_adimlar where id=veri->>'adim_id'; end if;
 if kart is null or not coalesce(public.kart_gorunur(kart),false) then raise exception 'Bu karta erişiminiz yok.'; end if;
 perform 1 from public.urun_kartlari where id=kart for update;
 if islem<>'dokuman' then
   select * into a from public.urun_adimlar where id=veri->>'adim_id' for update;
   if coalesce(a.arsivlendi,false) then raise exception 'Arşivlenmiş adım değiştirilemez.'; end if;
 end if;
 if islem<>'karar' then
   if rol not in ('admin','personel') then raise exception 'Bu işlem yalnızca ekip içindir.'; end if;
   if islem<>'dokuman' and rol<>'admin' and coalesce(a.atanan,'')<>'' and a.atanan<>public.aktif_personel_adi() then
     raise exception 'Bu adım size atanmamış.';
   end if;
 end if;
 if islem='bagimlilik' then
   if rol<>'admin' then raise exception 'Bağımlılıkları yönetici düzenler.'; end if;
   bag=coalesce(veri->'bagimliliklar','[]');
   if jsonb_typeof(bag)<>'array' then raise exception 'Adım listesi gerekli.'; end if;
   if exists(select 1 from jsonb_array_elements_text(bag) x(id) left join public.urun_adimlar b on b.id=x.id
     where b.id is null or b.id=a.id or b.kart_id<>kart or coalesce(b.arsivlendi,false)) then
     raise exception 'Aynı karttaki aktif adımları seçin; adım kendisine bağlanamaz.';
   end if;
   if exists(with recursive yol(id,ziyaret) as (
     select x.id,array[a.id,x.id] from jsonb_array_elements_text(bag) x(id)
     union all
     select x.id,y.ziyaret||x.id from yol y join public.urun_adimlar b on b.id=y.id
       cross join lateral jsonb_array_elements_text(b.wf_bagimliliklar) x(id)
       where y.id<>a.id and (x.id=a.id or not x.id=any(y.ziyaret))
   ) select 1 from yol where id=a.id) then raise exception 'Bu bağlantı döngü oluşturur.'; end if;
   if a.durum in ('Devam Ediyor','Tamamlandı') and exists(select 1 from jsonb_array_elements_text(bag) x(id)
     join public.urun_adimlar b on b.id=x.id where b.durum<>'Tamamlandı') then
     raise exception 'Başlamış işe tamamlanmamış bir ön koşul eklenemez.';
   end if;
   update public.urun_adimlar set wf_bagimliliklar=bag where id=a.id;
 elsif islem='durum' then
   if a.musteri_adimi then raise exception 'Müşteri adımında dosyaları onaya sunun.'; end if;
   if a.durum is distinct from veri->>'onceki_durum' then raise exception 'İş başka bir oturumda değişti. Yenileyin.'; end if;
   yeni_durum=veri->>'durum';
   if yeni_durum not in ('Bekliyor','Devam Ediyor','Tamamlandı','RET') then raise exception 'Geçersiz durum.'; end if;
   update public.urun_adimlar set durum=yeni_durum where id=a.id;
 elsif islem='dokuman' then
   path=veri->>'dosya_yolu';
   if split_part(path,'/',1)<>kart or not exists(select 1 from storage.objects where bucket_id='urun-dokumanlari' and name=path) then
     raise exception 'Yüklenmiş dosya bulunamadı.';
   end if;
   if exists(select 1 from public.urun_dokumanlari where dosya_yolu=path) then raise exception 'Dosya zaten kayıtlı.'; end if;
   kid=gen_random_uuid()::text; seri=kid; s_no=1;
   if nullif(veri->>'onceki_id','') is not null then
     select * into onceki from public.urun_dokumanlari where id=veri->>'onceki_id' and kart_id=kart;
     if not found then raise exception 'Önceki sürüm bulunamadı.'; end if;
     seri=onceki.wf_seri;
     select coalesce(max(wf_surum),0)+1 into s_no from public.urun_dokumanlari where wf_seri=seri;
   end if;
   insert into public.urun_dokumanlari(id,kart_id,dosya_adi,dosya_yolu,dosya_turu,boyut_kb,yukleyen,yuklenme_tarihi,wf_seri,wf_surum)
     values(kid,kart,veri->>'dosya_adi',path,veri->>'dosya_turu',(veri->>'boyut_kb')::integer,public.aktif_ad(),current_date,seri,s_no)
     returning * into d;
   return to_jsonb(d);
 elsif islem='sun' then
   if not a.musteri_adimi then raise exception 'Bu adım müşteri onayı değil.'; end if;
   if exists(select 1 from public.onay_paketleri where adim_id=a.id and durum='Bekliyor') then raise exception 'Zaten müşteri yanıtı bekleniyor.'; end if;
   engel=public.wf_engeller(a.id);
   if cardinality(engel)>0 then raise exception 'Ön koşullar tamamlanmalı: %',array_to_string(engel,', '); end if;
   select * into hedef from public.urun_adimlar where id=veri->>'duzeltme_adim_id' and kart_id=kart for update;
   if not found or hedef.id=a.id or hedef.musteri_adimi or coalesce(hedef.arsivlendi,false) or coalesce(hedef.atanan,'')='' then
     raise exception 'Revizyonu karşılayacak sorumlusu atanmış bir üretim adımı seçin.';
   end if;
   if hedef.durum<>'Tamamlandı' then raise exception 'Üretim adımı tamamlanmadan onaya sunulamaz.'; end if;
   if exists(with recursive yol(id,ziyaret) as (
     select hedef.id,array[hedef.id] union all select x.id,y.ziyaret||x.id from yol y
     join public.urun_adimlar b on b.id=y.id cross join lateral jsonb_array_elements_text(b.wf_bagimliliklar) x(id)
     where not x.id=any(y.ziyaret)
   ) select 1 from yol where id=a.id) then raise exception 'Revizyon adımı bu müşteri onayına bağımlı olamaz.'; end if;
   hedef_tarih=(veri->>'revizyon_hedefi')::date;
   if hedef_tarih is null or hedef_tarih<current_date then raise exception 'Bugün veya sonrası için revizyon hedefi seçin.'; end if;
   select array_agg(x.id) into sec from jsonb_array_elements_text(veri->'dosya_ids') x(id);
   if coalesce(cardinality(sec),0)=0 then raise exception 'En az bir dosya seçin.'; end if;
   select jsonb_agg(jsonb_build_object('id',u.id,'dosya_adi',u.dosya_adi,'dosya_yolu',u.dosya_yolu,'surum',u.wf_surum,'seri',u.wf_seri) order by u.id)
     into snap from public.urun_dokumanlari u where u.id=any(sec) and u.kart_id=kart;
   if coalesce(jsonb_array_length(snap),0)<>cardinality(sec) then raise exception 'Dosyalar bu karta ait olmalı ve tekrarlanmamalı.'; end if;
   if exists(select 1 from public.urun_dokumanlari u where u.id=any(sec) and exists(
      select 1 from public.urun_dokumanlari v where v.wf_seri=u.wf_seri and v.wf_surum>u.wf_surum)) then
     raise exception 'Onaya yalnızca serinin son sürümü sunulabilir.';
   end if;
   select * into r from public.revizyon_turlari where onay_adim_id=a.id and yeniden_sunuldu is null for update;
   if found then
     if r.uretim_adim_id<>hedef.id then raise exception 'Açık revizyonun üretim adımını seçin.'; end if;
     if not exists(
       select 1 from jsonb_array_elements(snap) yeni
       join public.urun_dokumanlari yd on yd.id=yeni->>'id'
       where exists(
         select 1 from public.onay_paketleri op
         cross join lateral jsonb_array_elements(op.dosyalar) eski
         where op.id=r.paket_id
           and eski->>'seri'=yd.wf_seri
           and (eski->>'surum')::integer<yd.wf_surum
       )
     ) then raise exception 'Revizyon sonrası reddedilen dosya ailesinin daha yeni sürümü gerekli.'; end if;
     update public.revizyon_turlari set yeniden_sunuldu=now(),harcanan_dk=greatest(0,coalesce(hedef.gercek_sure,0)-baslangic_dk) where id=r.id;
   end if;
   select coalesce(max(tur),0)+1 into tur_no from public.onay_paketleri where adim_id=a.id;
   insert into public.onay_paketleri(kart_id,adim_id,tur,dosyalar,duzeltme_adim_id,revizyon_hedefi)
     values(kart,a.id,tur_no,snap,hedef.id,hedef_tarih) returning * into p;
   update public.urun_adimlar set durum='Devam Ediyor' where id=a.id;
   return to_jsonb(p);
 elsif islem='karar' then
   if rol<>'musteri' or not a.musteri_adimi then raise exception 'Bu karar yalnızca ilgili müşteri içindir.'; end if;
   select * into p from public.onay_paketleri where id=veri->>'paket_id' and adim_id=a.id and durum='Bekliyor' for update;
   if not found then raise exception 'Bu onay isteği artık güncel değil. Yenileyin.'; end if;
   v_karar=veri->>'karar'; v_aciklama=trim(coalesce(veri->>'not',''));
   if v_karar not in ('onay','revizyon') or v_karar is null then raise exception 'Geçersiz karar.'; end if;
   if v_karar='revizyon' and v_aciklama='' then raise exception 'Revizyon açıklaması zorunlu.'; end if;
   if cardinality(public.wf_engeller(a.id))>0 then raise exception 'Ön koşullar değişti. Ekip çalışmayı yeniden kontrol etmeli.'; end if;
   yeni_durum=case when v_karar='onay' then 'Tamamlandı' else 'RET' end;
   update public.onay_paketleri set durum=case when v_karar='onay' then 'Onaylandı' else 'Revizyon' end,
     karar_zamani=now(),karar_veren=public.aktif_ad(),aciklama=v_aciklama where id=p.id;
   update public.urun_adimlar set durum=yeni_durum where id=a.id;
   not_id=gen_random_uuid()::text;
   insert into public.urun_adim_notlari(id,adim_id,metin,yazan,tarih)
     values(not_id,a.id,'Tur '||p.tur||case when v_karar='onay' then ' — Onaylandı' else ' — Revizyon istendi' end||': '||v_aciklama,public.aktif_ad(),current_date);
   if v_karar='revizyon' then
     select * into hedef from public.urun_adimlar where id=p.duzeltme_adim_id for update;
     if coalesce(hedef.atanan,'')='' or coalesce(hedef.arsivlendi,false) then raise exception 'Revizyon sorumlusu ekip tarafından düzenlenmeli.'; end if;
     insert into public.revizyon_turlari(kart_id,paket_id,onay_adim_id,uretim_adim_id,sorumlu,hedef_tarih,aciklama,baslangic_dk)
       values(kart,p.id,a.id,hedef.id,hedef.atanan,greatest(p.revizyon_hedefi,current_date),v_aciklama,coalesce(hedef.gercek_sure,0));
     update public.urun_adimlar set durum='RET',tarih=greatest(p.revizyon_hedefi,current_date)::text where id=hedef.id;
     insert into public.bildirimler(id,alici,tip,baslik,metin,kart_id,adim_id,olusturan)
       values(gen_random_uuid()::text,hedef.atanan,'musteri_ret','Revizyon işi yeniden açıldı',v_aciklama,kart,hedef.id,public.aktif_ad());
   end if;
   return jsonb_build_object('success',true,'durum',yeni_durum,'paket_id',p.id,'duzeltme_adim_id',p.duzeltme_adim_id,
     'not',jsonb_build_object('id',not_id,'metin','Tur '||p.tur||' — '||v_karar||': '||v_aciklama,'yazan',public.aktif_ad(),'tarih',current_date));
 else raise exception 'Bilinmeyen akış işlemi.';
 end if;
 select * into a from public.urun_adimlar where id=a.id;
 return to_jsonb(a);
end $$;

revoke all on function public.workflow_v2(text,jsonb) from public,anon;
grant execute on function public.workflow_v2(text,jsonb) to authenticated;
revoke all on function public.wf_engeller(text),public.wf_dosya_kilitli(text) from public,anon;
grant execute on function public.wf_engeller(text),public.wf_dosya_kilitli(text) to authenticated,service_role;
revoke all on function public.wf_adim_koru(),public.wf_dokuman_koru() from public,anon,authenticated;

-- Müşteri karar vermeden önce yanlış onay paketi geri çekilebilir. Paket kaydı
-- denetim izi olarak kalır; yalnızca bu paket tarafından kilitlenen dosya silinebilir.
create or replace function public.workflow_onay_geri_cek(p_adim_id text,p_paket_id text,p_neden text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 a public.urun_adimlar%rowtype; p public.onay_paketleri%rowtype;
 kart text; rol text; neden text; not_id text;
begin
 rol=public.aktif_rol(); neden=trim(coalesce(p_neden,''));
 if auth.uid() is null or rol not in ('admin','personel') then raise exception 'Bu işlem yalnızca ekip içindir.'; end if;
 select kart_id into kart from public.urun_adimlar where id=p_adim_id;
 if kart is null or not coalesce(public.kart_gorunur(kart),false) then raise exception 'Bu karta erişiminiz yok.'; end if;
 perform 1 from public.urun_kartlari where id=kart for update;
 select * into a from public.urun_adimlar where id=p_adim_id for update;
 if coalesce(a.arsivlendi,false) or not a.musteri_adimi then raise exception 'Geçerli bir müşteri onay adımı seçin.'; end if;
 if rol<>'admin' and coalesce(a.atanan,'')<>'' and a.atanan<>public.aktif_personel_adi() then raise exception 'Bu adım size atanmamış.'; end if;
 if neden='' then raise exception 'Geri çekme nedeni zorunlu.'; end if;
 select * into p from public.onay_paketleri
   where id=p_paket_id and adim_id=a.id and durum='Bekliyor' for update;
 if not found then raise exception 'Bu onay isteği artık beklemiyor. Sayfayı yenileyin.'; end if;
 update public.onay_paketleri set durum='Geri Çekildi',geri_cekildi=now(),
   geri_ceken=public.aktif_ad(),geri_cekme_nedeni=neden where id=p.id returning * into p;
 update public.urun_adimlar set durum='RET' where id=a.id;
 not_id=gen_random_uuid()::text;
 insert into public.urun_adim_notlari(id,adim_id,metin,yazan,tarih)
   values(not_id,a.id,'Tur '||p.tur||' — Ekip tarafından geri çekildi: '||neden,public.aktif_ad(),current_date);
 return to_jsonb(p);
end $$;
revoke all on function public.workflow_onay_geri_cek(text,text,text) from public,anon;
grant execute on function public.workflow_onay_geri_cek(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
