const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FILE = path.join(__dirname, 'index.html');
const SUPABASE = 'https://wimqfhjyflraorytlnsl.supabase.co';
const CDN = 'https://cdnjs.cloudflare.com';

/*
  Güvenlik başlıkları (PentestTools taraması, 16.08.2026).

  CSP notu: panel HTML'i satır içi onclick işleyicileri ve tek bir gömülü
  <script> bloğu üzerine kurulu, bu yüzden 'unsafe-inline' zorunlu —
  kaldırmak arayüzün tamamını çalışmaz hale getirir. Yine de CSP boş yere
  konmuyor: frame-ancestors clickjacking'i, connect-src verinin başka bir
  sunucuya sızdırılmasını, object-src eklenti tabanlı saldırıları kapatıyor.
  XSS'in asıl savunması render tarafındaki kaçırma (kacir/jsKacir/htmlTemizle).
*/
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CDN}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE}`,
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} ${CDN}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const GUVENLIK_BASLIKLARI = {
  'Content-Security-Policy': CSP,
  // Railway TLS'i sonlandırıyor; tarayıcı bu alan adına yalnızca HTTPS ile gelsin
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()'
};

/*
  SÜRÜM UCU (/surum)

  Panel tek dosyalık bir uygulama ve bildirim e-postalarının HTML'i tarayıcıda
  üretiliyor. Sekme günlerce açık kaldığında sunucudaki panel güncellense bile
  o sekme eski kodu çalıştırmaya devam eder. 17.08.2026'da tam olarak bu oldu:
  e-posta bağlantısı canlıya çıktıktan 10 dakika sonra, açık bir sekmeden
  bağlantısız mail gitti.

  Özet süreç başlarken bir kez hesaplanıyor; Railway her dağıtımda yeni bir kap
  başlattığı için dosya çalışma sırasında değişmez.
*/
const crypto = require('crypto');
let SURUM = 'bilinmiyor';
try {
  SURUM = crypto.createHash('sha1').update(fs.readFileSync(FILE)).digest('hex').slice(0, 12);
} catch (e) {
  console.error('Sürüm özeti hesaplanamadı:', e.message);
}

http.createServer((req, res) => {
  if (req.url === '/surum' || req.url.startsWith('/surum?')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...GUVENLIK_BASLIKLARI
    });
    res.end(JSON.stringify({ surum: SURUM }));
    return;
  }
  fs.readFile(FILE, (err, data) => {
    if (err) {
      res.writeHead(500, GUVENLIK_BASLIKLARI);
      res.end('Server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      ...GUVENLIK_BASLIKLARI
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Lokasyon Operasyon Paneli: http://localhost:${PORT}`);
});
