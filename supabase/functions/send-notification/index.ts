import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Adim bildirimi. Panel bir adim "Tamamlandi" yapildiginda cagirir.
//
// GUVENLIK, iki katman:
//  1) Cagiran panele giris yapmis bir EKIP uyesi olmali (gecerli Auth jetonu).
//  2) Alici adresi SERBEST DEGIL: yalnizca personeller tablosunda kayitli bir
//     e-postaya gonderim yapilir.
// Ilk katman olmadan, URL'yi bilen biri sirketin alan adindan personele
// istedigi konu ve HTML'i gonderebiliyordu -- SPF/DKIM gecerli oldugu icin
// ikna edici bir ic oltalama araci olurdu.

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (govde: unknown, durum = 200) =>
  new Response(JSON.stringify(govde), { status: durum, headers: { ...corsHeaders, "Content-Type": "application/json" } })

/*
  Cagiran panele giris yapmis bir EKIP uyesi mi?
  Alici kisiti disaridan mail atilmasini engelliyordu ama fonksiyon hâlâ
  herkese acikti: saldirgan sirketin alan adindan personele istedigi konu ve
  HTML'i gonderebiliyordu (SPF/DKIM gecerli oldugu icin ikna edici bir ic
  oltalama araci). Artik gecerli jeton sart.
*/
async function ekipUyesiMi(req: Request): Promise<boolean> {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!jeton || jeton === ANON_KEY || jeton.startsWith("sb_publishable_")) return false
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) return false
  const u = await r.json() as { id?: string }
  if (!u.id) return false
  const p = await fetch(`${SB_URL}/rest/v1/kullanicilar?auth_uid=eq.${u.id}&select=rol`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!p.ok) return false
  const satir = await p.json() as Array<{ rol?: string }>
  return satir[0]?.rol === "admin" || satir[0]?.rol === "personel"
}

// personeller tablosundaki e-postalar (kucuk harfe indirgenmis)
async function izinliAdresler(): Promise<Set<string>> {
  const r = await fetch(`${SB_URL}/rest/v1/personeller?select=email`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!r.ok) throw new Error(`personeller okunamadi (${r.status})`)
  const satirlar = await r.json() as Array<{ email?: string }>
  return new Set(
    satirlar.map((p) => (p.email ?? "").trim().toLowerCase()).filter((e) => e.length > 0),
  )
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    if (!await ekipUyesiMi(req)) {
      return json({ error: "Bu islem icin panele giris yapmis olmaniz gerekir." }, 401)
    }

    const { to, subject, html } = await req.json()

    if (!to || !subject || !html) {
      return json({ error: "Eksik alan: to, subject, html gerekli" }, 400)
    }

    // --- Alici kisiti ---
    const izinli = await izinliAdresler()
    if (!izinli.has(String(to).trim().toLowerCase())) {
      console.warn("Izinsiz alici reddedildi:", to)
      return json({ error: "Bu adrese gonderim yapilamaz. Alici, personeller listesinde kayitli olmalidir." }, 403)
    }

    const govde: Record<string, unknown> = { from: FROM_EMAIL, to: [to], subject, html }
    if (REPLY_TO) govde.reply_to = REPLY_TO

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(govde),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) return json({ error: data }, res.status)

    return json({ success: true, data })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
