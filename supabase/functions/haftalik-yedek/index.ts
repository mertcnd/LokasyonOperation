import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Veri yedegi. 2 gunde bir, TR gece yarisi (pg_cron zamani: 0 21 her 2 gunde).
//
// GUVENLIK: cron anahtari ya da yonetici jetonu sart. Onceden kimlik
// aranmiyordu; URL'yi bilen herkes yedek aldirabiliyordu.
//
// TABLO LISTESI: 16.08.2026'da geri donus provasi sirasinda m_fiyatlar_marka
// (147 satir, markaya ozel fiyatlarin tamami), dokuman_notlari,
// haftalik_ozet_abonelikleri, is_akisi_sablonlari ve giris_kayitlari'nin
// yedege HIC girmedigi ortaya cikti. Liste tamamlandi.
// sistem_gizli bilerek disarida: cron anahtarini yedek dosyasina yazmak,
// sirri yedek sayisi kadar cogaltmak olurdu.
//
// KAPSAM: yalnizca VERITABANI. Storage'daki PDF/gorseller dahil degil (93 MB);
// onlarin kaybi ayri bir risktir.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const YEDEK_MAIL = Deno.env.get("YEDEK_MAIL") || ""

const TABLOLAR = [
  "personeller", "is_turleri", "markalar", "gorevler", "izinler",
  "todos", "sim_kayitlar", "m_fiyatlar", "m_fiyatlar_marka", "gorev_notlari",
  "urun_kartlari", "urun_adimlar", "urun_adim_notlari", "urun_dokumanlari",
  "dokuman_notlari", "is_akisi_sablonlari", "haftalik_ozet_abonelikleri",
  "kullanicilar", "giris_kayitlari",
]

const srv = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

async function cronAnahtariGecerliMi(req: Request): Promise<boolean> {
  const gelen = (req.headers.get("x-cron-anahtar") || "").trim()
  if (!gelen) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/sistem_gizli?anahtar=eq.cron&select=deger`, { headers: srv })
  if (!r.ok) return false
  const satir = await r.json() as Array<{ deger?: string }>
  const beklenen = satir[0]?.deger ?? ""
  if (!beklenen || beklenen.length !== gelen.length) return false
  let fark = 0
  for (let i = 0; i < beklenen.length; i++) fark |= beklenen.charCodeAt(i) ^ gelen.charCodeAt(i)
  return fark === 0
}

async function yoneticiMi(req: Request): Promise<boolean> {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!jeton || jeton === ANON_KEY || jeton.startsWith("sb_publishable_")) return false
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) return false
  const u = await r.json() as { id?: string }
  if (!u.id) return false
  const p = await fetch(`${SUPABASE_URL}/rest/v1/kullanicilar?auth_uid=eq.${u.id}&select=rol`, { headers: srv })
  if (!p.ok) return false
  const satir = await p.json() as Array<{ rol?: string }>
  return satir[0]?.rol === "admin"
}

serve(async (req) => {
  try {
    if (!await cronAnahtariGecerliMi(req) && !await yoneticiMi(req)) {
      return new Response(JSON.stringify({ error: "Yetkisiz" }),
        { status: 401, headers: { "Content-Type": "application/json" } })
    }

    const yedek: Record<string, unknown> = { tarih: new Date().toISOString() }
    let toplamKayit = 0
    const eksik: string[] = []

    for (const t of TABLOLAR) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*`, { headers: srv })
      if (r.ok) {
        const rows = await r.json()
        yedek[t] = rows
        toplamKayit += rows.length
      } else {
        yedek[t] = { hata: r.status }
        eksik.push(`${t} (${r.status})`)
      }
    }

    const bugun = new Date().toISOString().slice(0, 10)
    const dosyaAdi = `yedek_${bugun}.json`
    const icerik = JSON.stringify(yedek)

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/yedekler/${dosyaAdi}`, {
      method: "POST",
      headers: { ...srv, "Content-Type": "application/json", "x-upsert": "true" },
      body: icerik,
    })
    if (!up.ok) throw new Error(`Storage yazma hatasi: ${up.status} ${await up.text()}`)

    // 2 gunde bir alindigi icin 15 dosya yaklasik 1 ay geriye gider
    const listR = await fetch(`${SUPABASE_URL}/storage/v1/object/list/yedekler`, {
      method: "POST",
      headers: { ...srv, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 100, sortBy: { column: "name", order: "desc" } }),
    })
    if (listR.ok) {
      const dosyalar = await listR.json()
      for (const ad of dosyalar.slice(15).map((d: { name: string }) => d.name)) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/yedekler/${ad}`, { method: "DELETE", headers: srv })
      }
    }

    if (YEDEK_MAIL && RESEND_API_KEY && eksik.length) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [YEDEK_MAIL],
          subject: `Operasyon Paneli - yedek EKSIK alindi (${bugun})`,
          html: `<p>Yedek alindi ama bazi tablolar okunamadi:</p><p><b>${eksik.join("<br>")}</b></p>
                 <p>Dosya: ${dosyaAdi} - Toplam kayit: ${toplamKayit}</p>`,
        }),
      }).catch(() => {})
    }

    return new Response(JSON.stringify({
      success: true, dosya: dosyaAdi, tablo: TABLOLAR.length, kayit: toplamKayit,
      boyut_kb: Math.round(icerik.length / 1024), eksik,
    }), { headers: { "Content-Type": "application/json" } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } })
  }
})
