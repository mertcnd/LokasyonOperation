import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/*
  Panel asistani.

  GUVENLIK: Bu fonksiyon sirketin ANTHROPIC_API_KEY'i ile calisiyor. Onceden
  hicbir kimlik dogrulamasi yoktu; URL'yi bilen herkes istedigi istemi
  gonderip faturayi sirkete cikarabiliyordu (acik LLM vekili).

  Artik gecerli bir Auth jetonu ve panelde tanimli bir EKIP hesabi (admin
  veya personel) sart. Musteri hesaplarinin asistan sekmesi yok, onlar da
  reddedilir.

  Ek olarak istek boyutu sinirlandi: tek bir kullanicinin devasa baglam
  gondererek jeton yakmasini onlemek icin.
*/

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SRV_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

const EN_FAZLA_MESAJ = 40
const EN_FAZLA_BAGLAM = 120_000   // karakter

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (govde: unknown, durum = 200) =>
  new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

// Cagiran gercek bir ekip uyesi mi? Jeton yoksa ya da yayin anahtariysa hayir.
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
    headers: { apikey: SRV_KEY, Authorization: `Bearer ${SRV_KEY}` },
  })
  if (!p.ok) return false
  const satir = await p.json() as Array<{ rol?: string }>
  return satir[0]?.rol === "admin" || satir[0]?.rol === "personel"
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    if (!await ekipUyesiMi(req)) {
      return json({ error: "Bu islem icin panele giris yapmis olmaniz gerekir." }, 401)
    }

    const { messages, context } = await req.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages alani gerekli" }, 400)
    }
    if (messages.length > EN_FAZLA_MESAJ) {
      return json({ error: `Sohbet cok uzun (en fazla ${EN_FAZLA_MESAJ} mesaj).` }, 413)
    }

    const baglam = String(context ?? "").slice(0, EN_FAZLA_BAGLAM)

    const systemPrompt = `Sen "Lokasyon Istanbul Operasyon Paneli" icin bir analiz asistanisin.
Sana JSON formatinda panel verisi verilecek: personeller, izinler, urun kartlari ve is adimlari.
Gorevin: kullanicinin Turkce sorularini bu veriye dayanarak, kisa ve net sekilde cevaplamak.

Kurallar:
- Sadece verilen verideki bilgileri kullan. Veride olmayan seyi uydurma; bilmiyorsan "bu bilgi panelde yok" de.
- Sayisal analiz yaparken (toplam sure, yuk dagilimi, gecikme) hesabini dogru yap.
- Sureler dakika cinsindendir (idealDk, fiiliDk). Gerektiginde saate cevir (60 dk = 1 saat).
- "durum" alani: Bekliyor / Devam Ediyor / Tamamlandi. "arsiv":1 olanlar arsivlenmistir.
- Tarih formati YYYY-MM-DD. Bugunun tarihi veride "bugun" alaninda.
- Gecikmis = tarihi bugunden eski olup durumu Tamamlandi olmayan adimlar.
- Cevaplari duz metin ver (markdown baslik/yildiz kullanma), gerekirse kisa maddeler icin "•" kullan.
- Kisa tut: cogu soruya 3-8 cumle yeter.

PANEL VERISI:
${baglam || "(veri gonderilmedi)"}`

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: systemPrompt,
        messages: messages,
      }),
    })

    const data = await res.json()
    if (!res.ok) return json({ error: data.error?.message || data }, res.status)

    const reply = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")

    return json({ reply })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
