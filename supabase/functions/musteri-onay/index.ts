import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/*
  Musteri onay / revizyon islemi.

  Neden sunucuda: karar verildiginde sonraki adimin sorumlusuna e-posta
  gitmesi gerekiyor. Bunu panelde yapsaydik musterinin tarayicisina personel
  adlari ve e-posta adresleri inerdi. Burada musterinin gonderdigi tek sey
  adim kimligi, karar ve not; gerisini sunucu kendi anahtariyla yapiyor.

  Yetki zinciri (hepsi saglanmazsa 403):
    · cagiran kullanici kayitli ve rolu 'musteri'
    · adim musteri_adimi = true
    · adimin bagli oldugu kartin markasi kullanicinin markalari icinde
*/

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SRV_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") || ""

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (g: unknown, s = 200) =>
  new Response(JSON.stringify(g), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

const srv = { apikey: SRV_KEY, Authorization: `Bearer ${SRV_KEY}`, "Content-Type": "application/json" }

async function rest<T>(yol: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${yol}`, { headers: srv })
  if (!r.ok) throw new Error(`${yol} okunamadi (${r.status})`)
  return await r.json() as T[]
}

type Kullanici = {
  id: string; ad_soyad?: string; kullanici_adi?: string
  rol?: string; markalar?: string; auth_uid?: string | null
}
type Adim = {
  id: string; kart_id: string; sira: number; ad: string
  atanan?: string; durum?: string; tarih?: string; musteri_adimi?: boolean
}

function markalariCoz(u: Kullanici): string[] {
  try {
    const d = JSON.parse(u.markalar || "[]")
    return Array.isArray(d) ? d : []
  } catch { return [] }
}

async function cagiraniBul(req: Request, govdeId?: string): Promise<Kullanici | null> {
  const yetki = req.headers.get("Authorization") || ""
  const jeton = yetki.replace(/^Bearer\s+/i, "").trim()
  const anahtarMi = !jeton || jeton === ANON_KEY || jeton.startsWith("sb_publishable_")

  if (!anahtarMi) {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${jeton}` },
    })
    if (!r.ok) return null
    const u = await r.json() as { id?: string }
    if (!u.id) return null
    const satir = await rest<Kullanici>(`kullanicilar?auth_uid=eq.${u.id}&select=*`)
    return satir[0] ?? null
  }

  if (!govdeId) return null
  const satir = await rest<Kullanici>(`kullanicilar?id=eq.${encodeURIComponent(govdeId)}&select=*`)
  const k = satir[0]
  if (!k) return null
  if (k.auth_uid) return null   // Auth'a tasinmis hesap jetonsuz kabul edilmez
  return k
}

async function mailGonder(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return
  const govde: Record<string, unknown> = { from: FROM_EMAIL, to: [to], subject, html }
  if (REPLY_TO) govde.reply_to = REPLY_TO
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(govde),
    })
    if (!r.ok) console.warn("mail gonderilemedi", r.status, await r.text())
  } catch (e) {
    console.warn("mail hatasi", e)
  }
}

function kacir(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}

function mailGovdesi(o: {
  baslik: string; renk: string; kisi: string; giris: string
  kart: string; adim: string; not?: string; tarih?: string
}) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:${o.renk};padding:18px 24px;border-radius:10px 10px 0 0">
        <div style="color:#fff;font-size:16px;font-weight:700">${o.baslik}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
        <p style="font-size:14px;color:#333;margin:0 0 14px">Merhaba <strong>${kacir(o.kisi)}</strong>,</p>
        <p style="font-size:14px;color:#333;margin:0 0 14px">${o.giris}</p>
        <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Urun Karti</div>
          <div style="font-size:15px;font-weight:700;color:#1a237e;margin-bottom:10px">${kacir(o.kart)}</div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Adim</div>
          <div style="font-size:15px;font-weight:700;color:#333">${kacir(o.adim)}</div>
          ${o.tarih ? `<div style="font-size:12px;color:#e65100;margin-top:8px">Hedef Tarih: ${kacir(o.tarih)}</div>` : ""}
        </div>
        ${o.not ? `<div style="border-left:4px solid ${o.renk};background:#fff8f8;padding:12px 14px;border-radius:0 8px 8px 0;margin-bottom:16px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Musteri notu</div>
          <div style="font-size:13px;color:#333;line-height:1.6">${kacir(o.not)}</div>
        </div>` : ""}
        <p style="font-size:12px;color:#aaa;margin:0">Bu e-posta Operasyon Paneli tarafindan otomatik gonderilmistir.</p>
      </div>
    </div>`
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { adim_id, karar, not, kullanici_id } = await req.json()
    if (!adim_id || (karar !== "onay" && karar !== "revizyon")) {
      return json({ error: "Eksik veya gecersiz alan" }, 400)
    }
    if (karar === "revizyon" && !String(not || "").trim()) {
      return json({ error: "Revizyon icin aciklama zorunludur" }, 400)
    }

    const kullanici = await cagiraniBul(req, kullanici_id)
    if (!kullanici) return json({ error: "Oturum dogrulanamadi" }, 401)
    if (kullanici.rol !== "musteri") return json({ error: "Bu islem yalnizca musteri hesaplari icindir" }, 403)

    const adimlar = await rest<Adim>(`urun_adimlar?id=eq.${encodeURIComponent(adim_id)}&select=*`)
    const adim = adimlar[0]
    if (!adim) return json({ error: "Adim bulunamadi" }, 404)
    if (!adim.musteri_adimi) return json({ error: "Bu adim musteri onayina acik degil" }, 403)

    const kartlar = await rest<{ id: string; ad: string; kod?: string; marka?: string }>(
      `urun_kartlari?id=eq.${encodeURIComponent(adim.kart_id)}&select=*`)
    const kart = kartlar[0]
    if (!kart) return json({ error: "Kart bulunamadi" }, 404)

    const izinli = markalariCoz(kullanici)
    if (!kart.marka || !izinli.includes(kart.marka)) {
      return json({ error: "Bu calisma sizin markalariniza ait degil" }, 403)
    }
    if (karar === "onay" && adim.durum === "Tamamlandı") {
      return json({ error: "Bu adim zaten onaylanmis" }, 409)
    }

    const yeniDurum = karar === "onay" ? "Tamamlandı" : "RET"
    const kisi = kullanici.ad_soyad || kullanici.kullanici_adi || "Müşteri"
    const kartAdi = `${kart.kod ? kart.kod + " — " : ""}${kart.ad}`

    // 1) Adim durumu
    const p = await fetch(`${SB_URL}/rest/v1/urun_adimlar?id=eq.${encodeURIComponent(adim_id)}`, {
      method: "PATCH", headers: { ...srv, Prefer: "return=minimal" },
      body: JSON.stringify({ durum: yeniDurum }),
    })
    if (!p.ok) return json({ error: `Durum guncellenemedi (${p.status})` }, 500)

    // 2) Karar notu — kim, ne zaman, ne dedi
    const notMetni = (karar === "onay" ? "✔ Onaylandı" : "↩ Revizyon istendi") +
      (String(not || "").trim() ? ": " + String(not).trim() : "")
    const notKaydi = {
      id: crypto.randomUUID(),
      adim_id,
      metin: notMetni,
      yazan: kisi,
      tarih: new Date().toISOString().slice(0, 10),
    }
    await fetch(`${SB_URL}/rest/v1/urun_adim_notlari`, {
      method: "POST", headers: { ...srv, Prefer: "return=minimal" },
      body: JSON.stringify(notKaydi),
    })

    // 3) Bildirim
    const tumAdimlar = await rest<Adim>(
      `urun_adimlar?kart_id=eq.${encodeURIComponent(adim.kart_id)}&arsivlendi=is.false&select=*&order=sira.asc`)
    const hedefAdim = karar === "onay"
      ? tumAdimlar.find((a) => a.sira > adim.sira)   // sonraki adim
      : adim                                        // revizyonda adimin sahibi

    if (hedefAdim?.atanan) {
      const kisiler = await rest<{ ad: string; email?: string }>(
        `personeller?ad=eq.${encodeURIComponent(hedefAdim.atanan)}&select=ad,email`)
      const eposta = kisiler[0]?.email
      if (eposta) {
        const onay = karar === "onay"
        await mailGonder(
          eposta,
          onay
            ? `Müşteri Onayladı: ${kartAdi}`
            : `Müşteri Revizyon İstedi: ${kartAdi}`,
          mailGovdesi({
            baslik: "Lokasyon İstanbul Operasyon Paneli",
            renk: onay ? "#2e7d32" : "#c62828",
            kisi: hedefAdim.atanan,
            giris: onay
              ? `<strong>"${kacir(adim.ad)}"</strong> adımı müşteri tarafından onaylandı. Sıradaki adım sende:`
              : `<strong>"${kacir(adim.ad)}"</strong> adımı için müşteri revizyon istedi. Adım <strong>RET</strong> durumuna alındı:`,
            kart: kartAdi,
            adim: hedefAdim.ad,
            not: String(not || "").trim() || undefined,
            tarih: hedefAdim.tarih || undefined,
          }),
        )
      }
    }

    return json({
      success: true,
      durum: yeniDurum,
      not: { id: notKaydi.id, metin: notKaydi.metin, tarih: notKaydi.tarih, yazan: notKaydi.yazan },
    })
  } catch (err) {
    console.error(err)
    return json({ error: (err as Error).message }, 500)
  }
})
