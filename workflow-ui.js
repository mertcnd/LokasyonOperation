/* Workflow v2, çatı/derleme gerektirmeyen ek modül. */
let wfHazir=false,wfHata='',wfPaketler=[],wfRevizyonlar=[],wfFiltre='tumu',wfIslemSuruyor=false;
async function wfRPC(islem,veri={}){
  const r=await fetch(SB_URL+'/rest/v1/rpc/workflow_v2',{method:'POST',headers:SBH(),body:JSON.stringify({islem,veri})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||j.error||'Akış işlemi tamamlanamadı.');return j;
}
async function wfListe(table){
  const out=[];
  for(let offset=0;;offset+=500){
    const r=await fetch(SB_URL+'/rest/v1/'+table+'?select=*&order=id&limit=500&offset='+offset,{headers:SBH()});
    if(!r.ok)throw new Error('Akış kayıtları yüklenemedi.');const rows=await r.json();out.push(...rows);if(rows.length<500)return out;
  }
}
async function wfYukle(){
  try{
    await wfRPC('surum');
    const [p,r]=await Promise.all([wfListe('onay_paketleri'),musteriMi()?Promise.resolve([]):wfListe('revizyon_turlari')]);
    wfPaketler=p;wfRevizyonlar=r;wfHazir=true;wfHata='';
  }catch(e){wfHazir=false;wfPaketler=[];wfRevizyonlar=[];wfHata='Yeni iş akışı kullanılamıyor. Bağlantı ve veritabanı kurulumu kontrol edilmeli.';console.warn('Workflow:',e.message);}
}
async function wfYenile(){
  const steps=await wfListe('urun_adimlar');urunAdimlar=steps;await wfYukle();markaFiltresiUygula();
  if(aktifKartId){kartDokumanlari[aktifKartId]=await sbGet('urun_dokumanlari','kart_id=eq.'+encodeURIComponent(aktifKartId));renderKartDokumanlari(aktifKartId);renderDetayAdimlar();}
  renderGorevler();if(!musteriMi())renderRaporlama();
}
async function wfCalistir(fn){
  if(wfIslemSuruyor)return;wfIslemSuruyor=true;
  try{await fn();await wfYenile();}catch(e){alert(e.message);try{await wfYenile();}catch(_){}}finally{wfIslemSuruyor=false;}
}
function wfAlan(id,parent){let el=document.getElementById(id);if(!el){el=document.createElement('div');el.id=id;parent.prepend(el);}return el;}
function wfZaman(ts){return ts?new Date(ts).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'—';}
function wfAc(adimId){const a=urunAdimlar.find(x=>x.id===adimId);if(!a)return;switchTab('urun');kartDetayAc(a.kart_id);expandedAdimId=a.id;renderDetayAdimlar();document.getElementById('adim-krt-'+a.id)?.scrollIntoView({block:'center'});}
function wfAcikPaket(id){return wfPaketler.find(p=>p.adim_id===id&&p.durum==='Bekliyor');}
function wfGorevler(list){
  const el=wfAlan('wf-gunluk',document.getElementById('tab-gunluk'));
  if(musteriMi()){el.innerHTML='';return list;}
  if(!wfHazir){el.innerHTML='<div class="wf-box wf-warning">'+kacir(wfHata)+'</div>';return list;}
  const active=list.filter(a=>!a.arsivlendi&&a.durum!=='Tamamlandı');
  const groups={hazir:[],revizyon:[],bekleyen:[],risk:[],sahipsiz:[]};
  active.forEach(a=>{groups[WorkflowCore.group(a,urunAdimlar,wfRevizyonlar)]?.push(a);if(WorkflowCore.risks(a,urunAdimlar,today()).length)groups.risk.push(a);if(!a.atanan)groups.sahipsiz.push(a);});
  const labels={tumu:'Tüm işler',hazir:'Başlayabileceğim işler',revizyon:'Revizyonlar',bekleyen:'Bekleyen işler',risk:'Teslim riski',sahipsiz:'Sorumlusuz işler'};
  const visible=wfFiltre==='tumu'?list:groups[wfFiltre]||[];
  const pending=wfPaketler.filter(p=>p.durum==='Bekliyor'&&active.some(a=>a.id===p.adim_id));
  const long=pending.filter(p=>Date.now()-Date.parse(p.sunuldu)>3*86400000);
  const overloaded=personeller.filter(p=>{
    const load=active.filter(a=>a.atanan===p.ad&&a.tarih===today()&&!a.musteri_adimi).reduce((s,a)=>s+Number(a.sure||0),0);
    const leave=izinler.filter(i=>i.personel===p.ad&&i.tarih===today()).reduce((s,i)=>s+izinDkCevir(i.sure),0);
    return load>Math.max(0,gunlukMesaiDk(today())-leave);
  });
  el.innerHTML='<div class="wf-box"><h3>Bugün benden ne bekleniyor?</h3><p class="wf-muted">Aşağıdaki tarih, marka ve kişi filtreleri uygulanır. Risk listesi diğer gruplarla kesişebilir.</p><div class="wf-actions">'+Object.entries(labels).filter(([k])=>k!=='sahipsiz'||adminMi()).map(([k,l])=>`<button aria-pressed="${wfFiltre===k}" onclick="wfFiltre='${k}';renderGorevler()">${l} · ${k==='tumu'?list.length:groups[k].length}</button>`).join('')+'</div>'+
    (adminMi()?`<p>${long.length} onay 3 günden uzun süredir bekliyor · Bugünkü plan yükü kapasitesini aşan ${overloaded.length} kişi${overloaded.length?': '+overloaded.map(p=>kacir(p.ad)).join(', '):''}</p>`:'')+
    (wfFiltre!=='tumu'?'<div class="wf-grid">'+visible.map(a=>{
      const reasons=WorkflowCore.risks(a,urunAdimlar,today());const blocked=WorkflowCore.blockers(a,urunAdimlar);
      const p=wfAcikPaket(a.id);const r=wfRevizyonlar.find(r=>r.uretim_adim_id===a.id&&!r.yeniden_sunuldu);
      return `<div class="wf-item"><strong>${kacir(a.ad)}</strong><div class="wf-muted">${kacir(urunKartlari.find(k=>k.id===a.kart_id)?.ad||'')} · ${kacir(a.tarih||'Tarihsiz')}</div>${r?'<p>'+kacir(r.aciklama)+'</p>':''}${p?'<p>Müşteri yanıtı bekleniyor: '+wfZaman(p.sunuldu)+'</p>':a.musteri_adimi?'<p>Dosyalar onaya hazırlanıyor.</p>':''}${blocked.length?'<p>Ön koşul: '+blocked.map(b=>kacir(b?.ad||'Silinmiş adım')).join(', ')+'</p>':''}${reasons.length?'<p class="wf-warning">'+reasons.map(kacir).join(' · ')+'</p>':''}<button onclick="wfAc('${jsKacir(a.id)}')">İşi aç</button></div>`;
    }).join('')+(visible.length?'':'<p class="wf-empty">Bu grupta iş yok.</p>')+'</div>':'')+'</div>';
  return visible;
}
function wfAdimPanel(a){
  if(!wfHazir||a.arsivlendi)return '';
  const deps=WorkflowCore.dependencies(a),blocks=WorkflowCore.blockers(a,urunAdimlar);
  const affected=WorkflowCore.downstream(a.id,urunAdimlar).filter(b=>b.durum!=='Tamamlandı');
  const r=wfRevizyonlar.find(r=>r.uretim_adim_id===a.id&&!r.yeniden_sunuldu);
  const choices=urunAdimlar.filter(b=>b.kart_id===a.kart_id&&b.id!==a.id&&!b.arsivlendi);
  return `<div class="wf-box"><h3>İşin ilerleme koşulları</h3><p>${deps.length?'Ön koşullar: '+deps.map(id=>kacir(urunAdimlar.find(b=>b.id===id)?.ad||'Silinmiş adım')).join(', '):'Bağımsız iş: diğer adımlarla paralel ilerleyebilir.'}</p>${blocks.length?'<p class="wf-warning">Başlamak için '+blocks.map(b=>kacir(b?.ad||'eksik adım')).join(', ')+' tamamlanmalı.</p>':''}${affected.length?'<p>Bu iş gecikirse etkilenebilecek adımlar: '+affected.map(b=>kacir(b.ad)).join(', ')+'</p>':''}
    ${adminMi()?`<details><summary>Ön koşulları düzenle</summary><div id="wf-deps-${a.id}">${choices.map(b=>`<label><input type="checkbox" value="${kacir(b.id)}" ${deps.includes(b.id)?'checked':''}> ${kacir(b.ad)}</label>`).join('')}</div><button onclick="wfBagimlilikKaydet('${jsKacir(a.id)}')">Bağımlılıkları kaydet</button><p class="wf-muted">Hiçbir adım seçilmezse iş bağımsızdır. Sıralamayı değiştirmek bağımlılığı değiştirmez.</p></details>`:''}
    ${r?`<div class="wf-history"><strong>Aktif revizyon</strong><p>${kacir(r.aciklama)}</p><p>Hedef: ${kacir(a.tarih||r.hedef_tarih)} · Sorumlu: ${kacir(a.atanan||r.sorumlu)}</p><p class="wf-muted">Düzeltmeyi tamamlayın, yeni dosya sürümünü yükleyin ve müşteri adımından yeniden onaya sunun.</p><button onclick="wfAc('${jsKacir(r.onay_adim_id)}')">Onay adımını aç</button></div>`:''}
    ${a.musteri_adimi?wfOnayPanel(a,false):''}</div>`;
}
function wfOnayPanel(a,customer){
  const packages=wfPaketler.filter(p=>p.adim_id===a.id).sort((x,y)=>y.tur-x.tur),pending=packages.find(p=>p.durum==='Bekliyor');
  const docs=kartDokumanlari[a.kart_id]||[];
  const current=docs.filter(d=>!docs.some(x=>x.wf_seri===d.wf_seri&&x.wf_surum>d.wf_surum));
  const history=packages.map(p=>`<div class="wf-item"><strong>Tur ${p.tur} · ${kacir(p.durum)}</strong><p class="wf-muted">Sunuldu: ${wfZaman(p.sunuldu)}${p.karar_zamani?' · Karar: '+wfZaman(p.karar_zamani):''}${p.geri_cekildi?' · Geri çekildi: '+wfZaman(p.geri_cekildi):''}</p>${p.dosyalar.map(d=>`<div>${kacir(d.dosya_adi)} <span class="wf-badge">V${d.surum}</span> ${p.durum==='Geri Çekildi'?'<span class="wf-muted">Dosya kilidi kaldırıldı</span>':`<button onclick="wfDosyaAc('${jsKacir(p.id)}','${jsKacir(d.id)}')">Dosyayı aç</button>`}</div>`).join('')}${p.aciklama?'<p>'+kacir(p.aciklama)+'</p>':''}${p.geri_cekme_nedeni?'<p>Geri çekme nedeni: '+kacir(p.geri_cekme_nedeni)+'</p>':''}${p.karar_veren?'<p class="wf-muted">Karar veren: '+kacir(p.karar_veren)+'</p>':''}${p.geri_ceken?'<p class="wf-muted">Geri çeken: '+kacir(p.geri_ceken)+'</p>':''}</div>`).join('');
  let form='';
  if(!customer&&!pending&&adimBenimMi(a)){
    const rev=wfRevizyonlar.find(r=>r.onay_adim_id===a.id&&!r.yeniden_sunuldu);
    const targets=urunAdimlar.filter(b=>b.kart_id===a.kart_id&&!b.musteri_adimi&&!b.arsivlendi&&b.id!==a.id);
    form=`<details ${packages.length?'':'open'}><summary>${packages.length?'Yeni turu onaya sun':'Dosyaları onaya sun'}</summary><p class="wf-muted">Müşteri yalnızca seçtiğiniz sürümleri onaylar. Sunulan dosyalar korunur.</p><div id="wf-docs-${a.id}">${current.map(d=>`<label><input type="checkbox" value="${kacir(d.id)}"> ${kacir(d.dosya_adi)} · V${d.wf_surum||1}</label>`).join('')||'<p>Önce karta dosya yükleyin.</p>'}</div><label>Düzeltmeyi karşılayacak üretim adımı <select id="wf-target-${a.id}" ${rev?'disabled':''}><option value="">Seçin</option>${targets.map(b=>`<option value="${kacir(b.id)}" ${rev?.uretim_adim_id===b.id?'selected':''}>${kacir(b.ad)} — ${kacir(b.atanan||'Atanmamış')}</option>`).join('')}</select></label><label>Revizyon gelirse hedef tarih <input type="date" id="wf-deadline-${a.id}" min="${today()}" value="${a.tarih&&a.tarih>=today()?a.tarih:today()}"></label><button class="wf-primary" onclick="wfSun('${jsKacir(a.id)}')">Seçilen dosyaları onaya sun</button></details>`;
  }
  const withdraw=pending&&!customer&&adimBenimMi(a)?`<div class="wf-warning"><p>Yanlış dosya gönderildiyse müşteri karar vermeden önce paketi geri çekebilirsiniz.</p><button onclick="wfGeriCek('${jsKacir(a.id)}','${jsKacir(pending.id)}')">Onayı geri çek</button></div>`:'';
  return '<div class="wf-box"><h3>Dosya onayı ve sürüm geçmişi</h3>'+(pending?'<p>Müşteri yanıtı bekleniyor. Karar aşağıdaki turdaki dosyalara uygulanır.</p>':customer?'<p>Şu anda yanıtınızı bekleyen bir dosya paketi yok.</p>':'')+withdraw+form+'<div class="wf-history">'+(history||'<p class="wf-muted">Sürüme bağlı onay kaydı yok. Önceki adım durumları geriye dönük dosya onayı sayılmaz.</p>')+'</div></div>';
}
async function wfBagimlilikKaydet(id){
  const ids=[...document.querySelectorAll('#wf-deps-'+CSS.escape(id)+' input:checked')].map(x=>x.value);
  if(WorkflowCore.wouldCycle(id,ids,urunAdimlar)){alert('Bu bağlantı döngü oluşturur.');return;}
  await wfCalistir(()=>wfRPC('bagimlilik',{adim_id:id,bagimliliklar:ids}));
}
async function wfSun(id){
  const selected=[...document.querySelectorAll('#wf-docs-'+CSS.escape(id)+' input:checked')].map(x=>x.value);
  if(!selected.length){alert('En az bir dosya seçin.');return;}
  const target=document.getElementById('wf-target-'+id).value,deadline=document.getElementById('wf-deadline-'+id).value;
  if(!target||!deadline){alert('Üretim adımı ve revizyon hedef tarihi seçin.');return;}
  await wfCalistir(()=>wfRPC('sun',{adim_id:id,dosya_ids:selected,duzeltme_adim_id:target,revizyon_hedefi:deadline}));
}
async function wfGeriCek(adimId,paketId){
  const neden=prompt('Onayı neden geri çekiyorsunuz? Örn: Yanlış dosya gönderildi.');
  if(neden===null)return;
  if(!neden.trim()){alert('Geri çekme nedeni zorunlu.');return;}
  if(!confirm('Müşterinin bekleyen onayı geri çekilecek. Paketteki dosyalar daha sonra silinebilir. Devam edilsin mi?'))return;
  await wfCalistir(async()=>{
    const r=await fetch(SB_URL+'/rest/v1/rpc/workflow_onay_geri_cek',{method:'POST',headers:SBH(),body:JSON.stringify({p_adim_id:adimId,p_paket_id:paketId,p_neden:neden.trim()})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||j.error||'Onay geri çekilemedi.');return j;
  });
}
async function wfDosyaAc(pid,id){
  const d=wfPaketler.find(p=>p.id===pid)?.dosyalar.find(d=>d.id===id);if(!d)return;
  const win=window.open('about:blank','_blank');if(win)win.opener=null;
  try{const url=await imzaliDokumanUrl(d.dosya_yolu);if(win)win.location.href=url;else alert('Dosya için açılır pencereye izin verin.');}catch(e){win?.close();alert(e.message);}
}
async function wfDurum(id,val){
  const a=urunAdimlar.find(x=>x.id===id);if(!a)return;
  if(a.musteri_adimi){alert('Müşteri adımında dosyaları onaya sunun.');renderDetayAdimlar();renderGorevler();return;}
  const old=a.durum;
  await wfCalistir(async()=>{
    if(val==='Tamamlandı'&&adimTimerStates[id]?.running)await adimTimerDurdur(id);
    await wfRPC('durum',{adim_id:id,durum:val,onceki_durum:old});
    if(val==='Tamamlandı'&&old!==val)sonrakiAdimBildir(id);
  });
}
function wfSurumSecici(kartId){
  const input=document.getElementById('dosya-input');if(!input||musteriMi()||!wfHazir)return;
  let box=document.getElementById('wf-surum-secici');if(!box){box=document.createElement('div');box.id='wf-surum-secici';box.className='wf-box';document.getElementById('kart-dokumanlari').insertAdjacentElement('beforebegin',box);}
  box.innerHTML='<label>Yükleme türü <select id="wf-onceki-dosya"><option value="">Yeni belge (ayrı sürüm serisi)</option>'+(kartDokumanlari[kartId]||[]).filter(d=>!(kartDokumanlari[kartId]||[]).some(x=>x.wf_seri===d.wf_seri&&x.wf_surum>d.wf_surum)).map(d=>`<option value="${kacir(d.id)}">Yeni sürüm: ${kacir(d.dosya_adi)} (V${d.wf_surum||1})</option>`).join('')+'</select></label><p class="wf-muted">Yeni sürüm seçerken tek dosya yükleyin. Önceki sürüm ve üzerindeki yorumlar korunur.</p>';
}
function wfRapor(list){
  const parent=document.getElementById('r-sum-kpis')?.parentElement;if(!parent)return;
  const el=wfAlan('wf-rapor',parent);if(musteriMi()||!wfHazir){el.innerHTML='';return;}
  const ids=new Set(list.map(a=>a.id)),steps=urunAdimlar.filter(a=>ids.has(a.id));
  const m=WorkflowCore.metrics(steps,wfPaketler,wfRevizyonlar);
  const boxes=[['Zamanında tamamlanan',m.onTimeRate===null?'—':'%'+m.onTimeRate,m.measured+' ölçülebilen adım · '+m.unknown+' eski/bilinmeyen kayıt'],
    ['Ortalama müşteri bekleme',m.averageWait===null?'—':m.averageWait.toFixed(1)+' sa','Karar verilmiş '+wfPaketler.filter(p=>ids.has(p.adim_id)&&p.karar_zamani).length+' tur · takvim saati'],
    ['En uzun açık onay',m.oldestWait===null?'—':m.oldestWait.toFixed(1)+' sa',m.openApprovals+' açık tur · takvim saati'],
    ['Revizyon emeği',(m.revisionMinutes/60).toFixed(1)+' sa',m.revisionRounds+' tur · açık turlarda geçici toplam'],
    ['Üretim emeği',(m.productionMinutes/60).toFixed(1)+' sa','Girilen/sayaçla ölçülen fiili süre; revizyon dahil']];
  el.innerHTML='<div class="wf-box"><h3>İş neden uzuyor?</h3><p class="wf-muted">Rapor filtrelerindeki hedef tarihli adımlar ve bunlara bağlı onay/revizyon turları. Bekleme takvim süresidir; çalışma süresine eklenmez. Geçmişte tutulmamış zamanlar tahmin edilmez.</p><div class="wf-grid">'+boxes.map(([l,v,h])=>`<div class="wf-item"><strong>${l}</strong><div class="wf-kpi">${v}</div><div class="wf-muted">${h}</div></div>`).join('')+'</div></div>';
}
