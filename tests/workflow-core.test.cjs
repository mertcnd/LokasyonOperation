const {test}=require('node:test');const assert=require('node:assert/strict');
const W=require('../workflow-core.js');
const a={id:'a',kart_id:'k',durum:'RET',tarih:'2026-09-01',atanan:'Ada',wf_bagimliliklar:[]};
const b={id:'b',kart_id:'k',durum:'Bekliyor',tarih:'2026-09-10',atanan:'Ada',wf_bagimliliklar:['a']};
const c={id:'c',kart_id:'k',durum:'Bekliyor',tarih:'2026-09-11',atanan:'Ada',wf_bagimliliklar:['b']};
test('Bağımlılık engeli, zincirleme risk ve döngü',()=>{
 assert.equal(W.blockers(b,[a,b,c]).length,1);assert.deepEqual(W.downstream('a',[a,b,c]).map(x=>x.id),['b','c']);
 assert.equal(W.wouldCycle('a',['c'],[a,b,c]),true);assert.equal(W.wouldCycle('c',['a'],[a,b,c]),false);
 assert.ok(W.risks(c,[a,b,c],'2026-09-09').includes('Geciken ön koşuldan etkileniyor'));
 assert.equal(W.blockers(b,[{...a,durum:'Tamamlandı'},b]).length,0);
 assert.equal(W.blockers(b,[b]).length,1);
});
test('Revizyon günlük listede tamamlanmış işler arasında kaybolmaz',()=>{
 assert.equal(W.group(a,[a,b],[]),'revizyon');assert.equal(W.group(b,[a,b],[]),'bekleyen');
 assert.equal(W.group({...b,wf_bagimliliklar:[]},[a,b],[]),'hazir');
});
test('Eski tarihler uydurulmaz; İstanbul günü ve revizyon süresi doğru ölçülür',()=>{
 const steps=[{...a,durum:'Tamamlandı',gercek_sure:90,wf_tamamlandi:'2026-09-09T22:00:00Z',wf_teslim_hedefi:'2026-09-09'},{...b,durum:'Tamamlandı'},c];
 const packages=[{adim_id:'b',durum:'Onaylandı',sunuldu:'2026-09-08T00:00:00Z',karar_zamani:'2026-09-09T00:00:00Z'},{adim_id:'b',durum:'Bekliyor',sunuldu:'2026-09-09T00:00:00Z'}];
 const rounds=[{uretim_adim_id:'a',baslangic_dk:60},{uretim_adim_id:'a',yeniden_sunuldu:'2026-09-01',harcanan_dk:15}];
 const m=W.metrics(steps,packages,rounds,Date.parse('2026-09-09T12:00:00Z'));
 assert.equal(m.onTimeRate,0);assert.equal(m.unknown,1);assert.equal(m.averageWait,24);assert.equal(m.oldestWait,12);assert.equal(m.revisionMinutes,45);
 const empty=W.metrics([],packages,rounds);assert.equal(empty.onTimeRate,null);assert.equal(empty.averageWait,null);assert.equal(empty.revisionRounds,0);
});
