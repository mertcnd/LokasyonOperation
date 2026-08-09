import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Haftalık marka özeti — her pazartesi sabahı pg_cron tarafından tetiklenir.
// Önizleme:  GET  /haftalik-ozet?onizleme=1&marka=A101   -> HTML döner, mail atmaz
// Gönderim:  POST /haftalik-ozet                          -> aktif abonelikleri gönderir

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DURUM_RENK: Record<string, string> = {
  "Bekliyor": "#e65100",
  "Devam Ediyor": "#1565c0",
  "Tamamlandı": "#2e7d32",
  "RET": "#e53935",
}
const DURUM_ZEMIN: Record<string, string> = {
  "Bekliyor": "#fff3e0",
  "Devam Ediyor": "#e3f2fd",
  "Tamamlandı": "#e8f5e9",
  "RET": "#ffebee",
}

async function sbGet(table: string, query = "") {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*${query ? "&" + query : ""}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!r.ok) throw new Error(`${table} okunamadı (${r.status}): ${await r.text()}`)
  return await r.json()
}

function gunEkle(g: string, n: number) {
  const d = new Date(g + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function bugunTR() {
  // TR saati (UTC+3) — pazartesi 05:00 UTC'de tetiklendiğinde gün doğru olsun
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
}
function trTarih(g?: string | null) {
  if (!g) return "—"
  const [y, a, gg] = g.split("-")
  return `${gg}.${a}.${y}`
}
function esc(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
// Geçen haftanın pazartesi–pazar aralığı
function gecenHafta(bugun: string) {
  const d = new Date(bugun + "T12:00:00Z")
  const gun = d.getUTCDay() === 0 ? 7 : d.getUTCDay()   // 1=Pzt .. 7=Paz
  const buHaftaPzt = gunEkle(bugun, -(gun - 1))
  return { bas: gunEkle(buHaftaPzt, -7), bit: gunEkle(buHaftaPzt, -1), buHaftaPzt }
}

function rozet(durum: string) {
  const renk = DURUM_RENK[durum] || "#666"
  const zemin = DURUM_ZEMIN[durum] || "#f1f3f7"
  return `<span style="background:${zemin};color:${renk};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${esc(durum)}</span>`
}

async function ozetUret(marka: string) {
  const bugun = bugunTR()
  const hafta = gecenHafta(bugun)
  const haftaSonu = gunEkle(hafta.buHaftaPzt, 6)

  const [kartlarTum, adimlarTum] = await Promise.all([
    sbGet("urun_kartlari"),
    sbGet("urun_adimlar"),
  ])
  const kartlar = (kartlarTum as any[]).filter((k) => k.marka === marka)
  const kartIds = new Set(kartlar.map((k) => k.id))
  const adimlar = (adimlarTum as any[]).filter((a) => kartIds.has(a.kart_id) && !a.arsivlendi)

  const gecenHaftaAdim = adimlar.filter((a) => a.tarih && a.tarih >= hafta.bas && a.tarih <= hafta.bit)
  const tamamlanan = gecenHaftaAdim.filter((a) => a.durum === "Tamamlandı")
  const retler = adimlar.filter((a) => a.durum === "RET")
  const gecikmis = adimlar.filter((a) => a.durum !== "Tamamlandı" && a.tarih && a.tarih < bugun)
  const buHafta = adimlar.filter((a) => a.tarih && a.tarih >= hafta.buHaftaPzt && a.tarih <= haftaSonu)

  const aktifKartlar = kartlar.filter((k) => k.durum !== "Arşivlendi")
    .sort((a, b) => String(a.kod || "").localeCompare(String(b.kod || "")))

  const kutu = (baslik: string, deger: number | string, renk: string) =>
    `<td style="padding:0 6px" width="20%">
       <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 8px;text-align:center">
         <div style="font-size:22px;font-weight:800;color:${renk};line-height:1.1">${deger}</div>
         <div style="font-size:10px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.4px">${baslik}</div>
       </div>
     </td>`

  const kartBloklari = aktifKartlar.map((k) => {
    const kAdim = adimlar.filter((a) => a.kart_id === k.id).sort((a, b) => (a.sira || 0) - (b.sira || 0))
    const tam = kAdim.filter((a) => a.durum === "Tamamlandı").length
    const pct = kAdim.length ? Math.round((tam / kAdim.length) * 100) : 0
    const satirlar = kAdim.length
      ? kAdim.map((a) => {
          const ret = a.durum === "RET"
          const gec = a.durum !== "Tamamlandı" && a.tarih && a.tarih < bugun
          return `<tr style="background:${ret ? "#fff5f5" : "#fff"}">
            <td style="padding:7px 8px;font-size:12px;color:#888;border-bottom:1px solid #f0f3f8;width:26px">${a.sira ?? ""}</td>
            <td style="padding:7px 8px;font-size:12px;font-weight:600;color:${ret ? "#c62828" : "#222"};border-bottom:1px solid #f0f3f8">${esc(a.ad)}</td>
            <td style="padding:7px 8px;font-size:12px;color:#555;border-bottom:1px solid #f0f3f8">${esc(a.is_turu || "—")}</td>
            <td style="padding:7px 8px;font-size:12px;color:${gec ? "#c62828" : "#555"};border-bottom:1px solid #f0f3f8;white-space:nowrap">${trTarih(a.tarih)}${gec ? " ⚠" : ""}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #f0f3f8;text-align:right">${rozet(a.durum)}</td>
          </tr>`
        }).join("")
      : `<tr><td colspan="5" style="padding:12px;font-size:12px;color:#aaa;font-style:italic">Bu karta henüz adım eklenmemiş.</td></tr>`

    return `<div style="border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden">
      <div style="background:#f8fafc;padding:12px 14px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:14px;font-weight:800;color:#1a237e">
          ${k.kod ? `<span style="background:#1a237e;color:#fff;font-family:monospace;font-size:11px;padding:2px 8px;border-radius:5px;margin-right:8px">${esc(k.kod)}</span>` : ""}${esc(k.ad)}
        </div>
        <div style="font-size:11px;color:#888;margin-top:5px">
          ${tam} / ${kAdim.length} adım tamamlandı · %${pct} &nbsp;·&nbsp; Durum: ${esc(k.durum || "—")}
        </div>
      </div>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        <tr style="background:#fbfcfe">
          <th style="padding:6px 8px;font-size:10px;color:#888;text-align:left;text-transform:uppercase;letter-spacing:.4px">#</th>
          <th style="padding:6px 8px;font-size:10px;color:#888;text-align:left;text-transform:uppercase;letter-spacing:.4px">Adım</th>
          <th style="padding:6px 8px;font-size:10px;color:#888;text-align:left;text-transform:uppercase;letter-spacing:.4px">İş Türü</th>
          <th style="padding:6px 8px;font-size:10px;color:#888;text-align:left;text-transform:uppercase;letter-spacing:.4px">Tarih</th>
          <th style="padding:6px 8px;font-size:10px;color:#888;text-align:right;text-transform:uppercase;letter-spacing:.4px">Durum</th>
        </tr>
        ${satirlar}
      </table>
    </div>`
  }).join("")

  const konu = `${marka} · Haftalık Operasyon Özeti (${trTarih(hafta.bas)} – ${trTarih(hafta.bit)})`

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;background:#fff">
    <div style="background:#1a237e;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="color:#fff;font-size:18px;font-weight:800">${esc(marka)} · Haftalık Operasyon Özeti</div>
      <div style="color:#c5cae9;font-size:12px;margin-top:5px">${trTarih(hafta.bas)} – ${trTarih(hafta.bit)} · Lokasyon İstanbul Operasyon Paneli</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px">
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px"><tr>
        ${kutu("Aktif kart", aktifKartlar.length, "#1a237e")}
        ${kutu("Geçen hafta biten", tamamlanan.length, "#2e7d32")}
        ${kutu("RET", retler.length, "#e53935")}
        ${kutu("Gecikmiş", gecikmis.length, "#e65100")}
        ${kutu("Bu hafta planlı", buHafta.length, "#1565c0")}
      </tr></table>

      ${retler.length ? `<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:10px;padding:12px 14px;margin-bottom:18px">
        <div style="font-size:13px;font-weight:800;color:#c62828;margin-bottom:6px">⛔ RET verilen adımlar</div>
        ${retler.map((a) => {
          const k = kartlar.find((x) => x.id === a.kart_id)
          return `<div style="font-size:12px;color:#333;margin-top:3px">• <strong>${esc(a.ad)}</strong> — ${esc(k?.kod ? k.kod + " " : "")}${esc(k?.ad || "")}</div>`
        }).join("")}
      </div>` : ""}

      ${gecikmis.length ? `<div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:10px;padding:12px 14px;margin-bottom:18px">
        <div style="font-size:13px;font-weight:800;color:#e65100;margin-bottom:6px">⚠ Tarihi geçmiş adımlar</div>
        ${gecikmis.slice(0, 15).map((a) => {
          const k = kartlar.find((x) => x.id === a.kart_id)
          return `<div style="font-size:12px;color:#333;margin-top:3px">• <strong>${esc(a.ad)}</strong> — ${esc(k?.ad || "")} · hedef ${trTarih(a.tarih)}</div>`
        }).join("")}
        ${gecikmis.length > 15 ? `<div style="font-size:11px;color:#888;margin-top:6px">…ve ${gecikmis.length - 15} adım daha</div>` : ""}
      </div>` : ""}

      <div style="font-size:14px;font-weight:800;color:#1a237e;margin:22px 0 12px">Kartlar ve tüm adımlar</div>
      ${kartBloklari || `<div style="font-size:13px;color:#888;font-style:italic;padding:16px 0">${esc(marka)} markası için aktif ürün kartı bulunmuyor.</div>`}

      <div style="font-size:11px;color:#aaa;margin-top:22px;padding-top:14px;border-top:1px solid #f0f3f8">
        Bu e-posta Lokasyon İstanbul Operasyon Paneli tarafından her pazartesi otomatik gönderilir.
      </div>
    </div>
  </div>`

  return { html, konu, sayilar: { aktifKart: aktifKartlar.length, tamamlanan: tamamlanan.length, ret: retler.length, gecikmis: gecikmis.length, buHafta: buHafta.length } }
}

async function mailGonder(to: string, subject: string, html: string) {
  const govde: Record<string, unknown> = { from: FROM_EMAIL, to: [to], subject, html }
  if (REPLY_TO) govde.reply_to = REPLY_TO
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  })
  const veri = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(veri)}`)
  return veri
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const url = new URL(req.url)

  try {
    // ── ÖNİZLEME: mail atmadan HTML döndür ──
    if (url.searchParams.get("onizleme")) {
      const marka = url.searchParams.get("marka")
      if (!marka) throw new Error("marka parametresi gerekli")
      const { html } = await ozetUret(marka)
      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } })
    }

    // ── GÖNDERİM: aktif abonelikler ──
    const abonelikler = await sbGet("haftalik_ozet_abonelikleri", "aktif=eq.true")
    const sonuc: unknown[] = []
    const simdi = Date.now()

    for (const ab of abonelikler as any[]) {
      // Aynı gün içinde ikinci kez tetiklenirse tekrar göndermez
      if (ab.son_gonderim && simdi - new Date(ab.son_gonderim).getTime() < 12 * 3600 * 1000) {
        sonuc.push({ email: ab.alici_email, marka: ab.marka, durum: "atlandı (12 saat içinde gönderilmiş)" })
        continue
      }
      try {
        const { html, konu, sayilar } = await ozetUret(ab.marka)
        await mailGonder(ab.alici_email, konu, html)
        await fetch(`${SB_URL}/rest/v1/haftalik_ozet_abonelikleri?id=eq.${encodeURIComponent(ab.id)}`, {
          method: "PATCH",
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ son_gonderim: new Date().toISOString() }),
        })
        sonuc.push({ email: ab.alici_email, marka: ab.marka, durum: "gönderildi", sayilar })
      } catch (e) {
        sonuc.push({ email: ab.alici_email, marka: ab.marka, durum: "HATA", hata: String((e as Error).message || e) })
      }
    }

    return new Response(JSON.stringify({ tarih: new Date().toISOString(), abonelik: (abonelikler as any[]).length, sonuc }, null, 1), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
