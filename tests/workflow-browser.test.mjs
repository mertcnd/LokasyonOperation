import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

test('Panel, günlük grupları ve sürüme bağlı onay ekranlarını çizer', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
  await page.addInitScript(() => {
    if (localStorage.getItem('lokasyon_oturum')) return;
    localStorage.setItem('lokasyon_oturum', JSON.stringify({
      id: 'u1', kullanici_adi: 'ada@example.com', ad_soyad: 'Ada', rol: 'admin',
      sekmeler: ['gunluk', 'urun', 'raporlama'], personel_id: 'p1', markalar: [],
    }));
    localStorage.setItem('lokasyon_auth', JSON.stringify({
      access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Date.now() + 3600000,
    }));
    });
    const rows = {
    personeller: [{ id: 'p1', ad: 'Ada', seviye: 'Level 2', maliyet: 500 }],
    is_turleri: [{ id: 'i1', ad: 'Tasarım', sure_basit: 30, sure_normal: 60, sure_kompleks: 120 }],
    markalar: [{ id: 'm1', ad: 'Marka', renk: '#1565c0' }],
    gorevler: [], izinler: [], todos: [], sim_kayitlar: [], m_fiyatlar: [], m_fiyatlar_marka: [],
    is_akisi_sablonlari: [], bildirimler: [],
    urun_kartlari: [{ id: 'k1', ad: 'Etiket', kod: 'MK-1', marka: 'Marka', durum: 'Aktif', tarih: '2026-09-09', olusturan: 'Ada' }],
    urun_adimlar: [
      { id: 'a', kart_id: 'k1', sira: 1, ad: 'Tasarım', is_turu: 'Tasarım', atanan: 'Ada', durum: 'RET', tarih: '2026-09-09', sure: 60, gercek_sure: 90, arsivlendi: false, musteri_adimi: false, wf_bagimliliklar: [], wf_basladi: '2026-09-09T06:00:00Z' },
      { id: 'c', kart_id: 'k1', sira: 2, ad: 'Müşteri onayı', atanan: 'Ada', durum: 'RET', tarih: '2026-09-10', sure: 0, gercek_sure: 0, arsivlendi: false, musteri_adimi: true, wf_bagimliliklar: ['a'] },
    ],
    urun_dokumanlari: [
      { id: 'd1', kart_id: 'k1', dosya_adi: 'etiket.pdf', dosya_yolu: 'k1/v1.pdf', dosya_turu: 'pdf', boyut_kb: 20, yuklenme_tarihi: '2026-09-09', wf_seri: 's1', wf_surum: 1 },
      { id: 'd2', kart_id: 'k1', dosya_adi: 'etiket-v2.pdf', dosya_yolu: 'k1/v2.pdf', dosya_turu: 'pdf', boyut_kb: 21, yuklenme_tarihi: '2026-09-10', wf_seri: 's1', wf_surum: 2 },
    ],
    onay_paketleri: [{ id: 'o1', kart_id: 'k1', adim_id: 'c', tur: 1, durum: 'Revizyon', sunuldu: '2026-09-09T08:00:00Z', karar_zamani: '2026-09-09T12:00:00Z', karar_veren: 'Müşteri', aciklama: 'Barkod büyüsün', duzeltme_adim_id: 'a', revizyon_hedefi: '2026-09-12', dosyalar: [{ id: 'd1', dosya_adi: 'etiket.pdf', dosya_yolu: 'k1/v1.pdf', seri: 's1', surum: 1 }] }],
    revizyon_turlari: [{ id: 'r1', kart_id: 'k1', paket_id: 'o1', onay_adim_id: 'c', uretim_adim_id: 'a', sorumlu: 'Ada', hedef_tarih: '2026-09-12', aciklama: 'Barkod büyüsün', acildi: '2026-09-09T12:00:00Z', yeniden_sunuldu: null, baslangic_dk: 60 }],
    };
    await page.route('https://wimqfhjyflraorytlnsl.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/workflow_v2')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ surum: 2 }) });
      return;
    }
    const table = url.pathname.split('/').at(-1);
    let body = rows[table] || [];
    if (table === 'urun_dokumanlari' && !url.searchParams.has('kart_id')) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#wf-gunluk .wf-box', { timeout: 10000 });
    assert.match(await page.locator('#wf-gunluk').innerText(), /Bugün benden ne bekleniyor/);
    await page.getByRole('button', { name: /Revizyonlar · 1/ }).click();
    assert.match(await page.locator('#wf-gunluk').innerText(), /Barkod büyüsün/);
    await page.locator('#wf-gunluk').getByRole('button', { name: 'İşi aç' }).click();
    await page.waitForSelector('#wf-surum-secici');
    assert.match(await page.locator('#wf-surum-secici').innerText(), /etiket-v2.pdf \(V2\)/);
    assert.match(await page.locator('#detay-adimlar').innerText(), /Aktif revizyon/);
    await page.getByRole('button', { name: 'Onay adımını aç' }).click();
    assert.match(await page.locator('#detay-adimlar').innerText(), /Dosya onayı ve sürüm geçmişi/);
    await page.screenshot({ path: '/private/tmp/lokasyon-workflow.png', fullPage: true });

    rows.onay_paketleri[0] = {
      ...rows.onay_paketleri[0], durum: 'Bekliyor', karar_zamani: null,
      karar_veren: null, aciklama: null,
    };
    rows.urun_adimlar[1].durum = 'Devam Ediyor';
    await page.evaluate(() => {
      localStorage.setItem('lokasyon_oturum', JSON.stringify({
        id: 'u2', kullanici_adi: 'musteri@example.com', ad_soyad: 'Müşteri',
        rol: 'musteri', sekmeler: ['gunluk', 'urun', 'raporlama'], markalar: ['Marka'],
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof kartDetayAc === 'function' && document.querySelector('#urun-liste-view'));
    await page.waitForFunction(() => typeof wfHazir !== 'undefined' && wfHazir === true);
    await page.evaluate(() => kartDetayAc('k1'));
    const customerFlow = await page.locator('#detay-adimlar').innerText();
    assert.match(customerFlow, /Müşteri yanıtı bekleniyor/);
    assert.match(customerFlow, /etiket.pdf/);
    assert.doesNotMatch(customerFlow, /etiket-v2.pdf/);
    assert.match(customerFlow, /Onaylıyorum/);
    assert.match(customerFlow, /Revizyon İstiyorum/);
    assert.doesNotMatch(customerFlow, /Ön koşulları düzenle/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
