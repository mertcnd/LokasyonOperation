import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/*
  ZAMANLANMIS IS IZLEME

  cron.job_run_details "succeeded" yazar ama bu yalnizca SQL'in calistigini
  gosterir; fonksiyon 500 dondurse de "succeeded" gorunur. Nitekim haftalik
  ozet 10.08'de "succeeded" olmus, hicbir mail gitmemisti.

  Bu fonksiyon zamanli_is_kontrol() ile GERCEK HTTP yanitlarini isler ve
  basarisiz olan varsa yoneticiye mail atar. Sessiz kalmasi = her sey yolunda.
*/

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SRV_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const UYARI_MAIL = Deno.env.get("REPLY_TO_EMAIL") || Deno.env.get("YEDEK_MAIL") || ""

const srv = { apikey: SRV_KEY, Authorization: `Bearer ${SRV_KEY}`, "Content-Type": "application/json" }
const json = (g: unknown, s = 200) =>
  new Response(JSON.stringify(g), { status: s, headers: { "Content-Type": "application/json" } })

async function cronAnahtariGecerliMi(req: Request): Promise<boolean> {
  const gelen = (req.headers.get("x-cron-anahtar") || "").trim()
  if (!gelen) return false
  const r = await fetch(`${SB_URL}/rest/v1/sistem_gizli?anahtar=eq.cron&select=deger`, { headers: srv })
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
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jeton}` } })
  if (!r.ok) return false
  const u = await r.json() as { id?: string }
  if (!u.id) return false
  const p = await fetch(`${SB_URL}/rest/v1/kullanicilar?auth_uid=eq.${u.id}&select=rol`, { headers: srv })
  if (!p.ok) return false
  const satir = await p.json() as Array<{ rol?: string }>
  return satir[0]?.rol === "admin"
}

function kacir(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}

serve(async (req) => {
  try {
    if (!await cronAnahtariGecerliMi(req) && !await yoneticiMi(req)) {
      return json({ error: "Yetkisiz" }, 401)
    }

    const r = await fetch(`${SB_URL}/rest/v1/rpc/zamanli_is_kontrol`, { method: "POST", headers: srv, body: "{}" })
    if (!r.ok) throw new Error(`kontrol calistirilamadi (${r.status}): ${await r.text()}`)
    const basarisiz = await r.json() as Array<{ is_adi: string; baslama: string; http_durum: number; sonuc: string }>

    if (basarisiz.length && RESEND_API_KEY && UYARI_MAIL) {
      const satirlar = basarisiz.map((b) => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #f0f3f8;font-weight:700">${kacir(b.is_adi)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f0f3f8">${kacir(new Date(b.baslama).toLocaleString("tr-TR"))}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f0f3f8;color:#c62828;font-weight:700">${b.http_durum || "yanit yok"}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f0f3f8;font-size:11px;color:#555">${kacir(b.sonuc).slice(0, 200)}</td>
        </tr>`).join("")

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [UYARI_MAIL],
          subject: `Operasyon Paneli - ${basarisiz.length} zamanlanmis is BASARISIZ`,
          html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
            <div style="background:#c62828;padding:16px 22px;border-radius:10px 10px 0 0;color:#fff;font-size:16px;font-weight:700">
              Zamanlanmis is basarisiz
            </div>
            <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:18px 22px">
              <p style="font-size:14px;color:#333;margin:0 0 14px">
                Asagidaki zamanlanmis isler beklenen yaniti vermedi. Yedek alinmamis ya da
                haftalik ozet gonderilmemis olabilir.
              </p>
              <table width="100%" cellspacing="0" style="border-collapse:collapse;font-size:12px">
                <tr style="background:#f8fafc">
                  <th style="padding:7px 10px;text-align:left;font-size:10px;color:#888;text-transform:uppercase">Is</th>
                  <th style="padding:7px 10px;text-align:left;font-size:10px;color:#888;text-transform:uppercase">Zaman</th>
                  <th style="padding:7px 10px;text-align:left;font-size:10px;color:#888;text-transform:uppercase">HTTP</th>
                  <th style="padding:7px 10px;text-align:left;font-size:10px;color:#888;text-transform:uppercase">Yanit</th>
                </tr>
                ${satirlar}
              </table>
              <p style="font-size:11px;color:#aaa;margin-top:16px">
                Bu uyari yalnizca sorun varken gonderilir. Sessizlik = her sey yolunda.
              </p>
            </div>
          </div>`,
        }),
      }).catch((e) => console.warn("uyari maili gonderilemedi", e))
    }

    return json({ kontrol_edilen: "tamam", basarisiz: basarisiz.length, ayrinti: basarisiz })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
