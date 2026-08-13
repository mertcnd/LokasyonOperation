import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Adim bildirimi. Panel bir adim "Tamamlandi" yapildiginda cagirir.
//
// GUVENLIK: Bu fonksiyon JWT dogrulamasi olmadan calisiyor (panelde gercek
// oturum yok). Bu yuzden alici adresi SERBEST DEGIL: yalnizca personeller
// tablosunda kayitli bir e-postaya gonderim yapilir. Boylece URL'yi bilen biri
// sirketin alan adindan disariya mail atamaz.

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev"
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (govde: unknown, durum = 200) =>
  new Response(JSON.stringify(govde), { status: durum, headers: { ...corsHeaders, "Content-Type": "application/json" } })

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
