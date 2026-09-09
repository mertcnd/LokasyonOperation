/* Saf akış hesapları: arayüz ve testler aynı kuralları kullanır. */
(function(root){
  const dependencies = a => Array.isArray(a.wf_bagimliliklar) ? a.wf_bagimliliklar : [];
  function blockers(a, steps){
    return dependencies(a).map(id=>steps.find(b=>b.id===id&&b.kart_id===a.kart_id))
      .filter(b=>!b||b.arsivlendi||b.durum!=='Tamamlandı');
  }
  function downstream(id, steps){
    const seen=new Set([id]),result=[];
    function walk(parent){for(const a of steps){if(!a.arsivlendi&&dependencies(a).includes(parent)&&!seen.has(a.id)){seen.add(a.id);result.push(a);walk(a.id);}}}
    walk(id);return result;
  }
  function wouldCycle(id, ids, steps){return ids.some(dep=>dep===id||downstream(id,steps).some(a=>a.id===dep));}
  function risks(a,steps,day){
    const out=[];
    if(a.durum==='Tamamlandı'||a.arsivlendi)return out;
    if(!a.atanan)out.push('Sorumlu atanmamış');
    if(!a.tarih)out.push('Hedef tarih eksik');
    else if(a.tarih<day)out.push('Hedef tarih geçti');
    const late=steps.filter(b=>b.id!==a.id&&!b.arsivlendi&&b.durum!=='Tamamlandı'&&b.tarih&&b.tarih<day);
    if(late.some(b=>downstream(b.id,steps).some(x=>x.id===a.id)))out.push('Geciken ön koşuldan etkileniyor');
    return out;
  }
  function group(a,steps,rounds){
    if(a.durum==='Tamamlandı'||a.arsivlendi)return 'tamam';
    if(rounds.some(r=>r.uretim_adim_id===a.id&&!r.yeniden_sunuldu)||(!a.musteri_adimi&&a.durum==='RET'))return 'revizyon';
    if(a.musteri_adimi||blockers(a,steps).length)return 'bekleyen';
    return 'hazir';
  }
  function metrics(steps,packages,rounds,now=Date.now()){
    const ids=new Set(steps.map(a=>a.id));
    const done=steps.filter(a=>a.durum==='Tamamlandı');
    const measured=done.filter(a=>a.wf_tamamlandi&&a.wf_teslim_hedefi);
    const dateTR=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
    const onTime=measured.filter(a=>dateTR(a.wf_tamamlandi)<=a.wf_teslim_hedefi).length;
    const ps=packages.filter(p=>ids.has(p.adim_id));
    const hours=p=>Math.max(0,((p.karar_zamani?Date.parse(p.karar_zamani):now)-Date.parse(p.sunuldu))/3600000);
    const closed=ps.filter(p=>p.karar_zamani),open=ps.filter(p=>p.durum==='Bekliyor');
    const rs=rounds.filter(r=>ids.has(r.uretim_adim_id));
    const revMinutes=rs.reduce((n,r)=>n+(r.yeniden_sunuldu?Number(r.harcanan_dk||0):Math.max(0,Number(steps.find(a=>a.id===r.uretim_adim_id)?.gercek_sure||0)-Number(r.baslangic_dk||0))),0);
    return {onTimeRate:measured.length?Math.round(onTime/measured.length*100):null,measured:measured.length,unknown:done.length-measured.length,
      averageWait:closed.length?closed.reduce((n,p)=>n+hours(p),0)/closed.length:null,
      oldestWait:open.length?Math.max(...open.map(hours)):null,openApprovals:open.length,
      revisionMinutes:revMinutes,revisionRounds:rs.length,
      productionMinutes:steps.filter(a=>!a.musteri_adimi).reduce((n,a)=>n+Number(a.gercek_sure||0),0)};
  }
  const api={dependencies,blockers,downstream,wouldCycle,risks,group,metrics};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.WorkflowCore=api;
})(typeof window!=='undefined'?window:globalThis);
