import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/*
  YEDEKTEN GERI DONUS PROVASI

  En guncel yedegi depodan indirir, AYRI bir semaya (yedek_prova) gercek
  tablolara geri yukler ve canli tablolarla satir sayisi karsilastirir.
  Uretim verisine dokunmaz. Istenildigi zaman tekrar calistirilabilir.

  Yetki: cron anahtari ya da yonetici jetonu.
*/

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SRV_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

const srv = { apikey: SRV_KEY, Authorization: `Bearer ${SRV_KEY}`, "Content-Type": "application/json" }
const json = (g: unknown, s = 200) =>
  new Response(JSON.stringify(g, null, 1), { status: s, headers: { "Content-Type": "application/json" } })

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

serve(async (req) => {
  try {
    if (!await cronAnahtariGecerliMi(req) && !await yoneticiMi(req)) {
      return json({ error: "Yetkisiz" }, 401)
    }

    // 1) En guncel yedek dosyasini bul
    const l = await fetch(`${SB_URL}/storage/v1/object/list/yedekler`, {
      method: "POST", headers: srv,
      body: JSON.stringify({ prefix: "", limit: 100, sortBy: { column: "name", order: "desc" } }),
    })
    if (!l.ok) throw new Error(`yedek listesi alinamadi (${l.status})`)
    const dosyalar = await l.json() as Array<{ name: string }>
    if (!dosyalar.length) throw new Error("depoda yedek dosyasi yok")
    const dosya = dosyalar[0].name

    // 2) Indir
    const d = await fetch(`${SB_URL}/storage/v1/object/yedekler/${encodeURIComponent(dosya)}`, { headers: srv })
    if (!d.ok) throw new Error(`yedek indirilemedi (${d.status})`)
    const metin = await d.text()
    let veri: Record<string, unknown>
    try { veri = JSON.parse(metin) } catch { throw new Error("yedek JSON olarak cozulemedi -- dosya bozuk") }

    // 3) Ayri semaya geri yukle ve karsilastir
    const r = await fetch(`${SB_URL}/rest/v1/rpc/yedek_prova_yukle`, {
      method: "POST", headers: srv, body: JSON.stringify({ veri }),
    })
    if (!r.ok) throw new Error(`geri yukleme basarisiz (${r.status}): ${(await r.text()).slice(0, 300)}`)
    const satirlar = await r.json() as Array<{ tablo: string; yedekteki: number; geri_yuklenen: number; canlidaki: number }>

    const uyusmayan = satirlar.filter((s) => s.yedekteki !== s.geri_yuklenen || s.geri_yuklenen !== s.canlidaki)
    const toplamKayit = satirlar.reduce((a, s) => a + s.geri_yuklenen, 0)

    return json({
      dosya,
      boyut_kb: Math.round(metin.length / 1024),
      tablo_sayisi: satirlar.length,
      geri_yuklenen_kayit: toplamKayit,
      sonuc: uyusmayan.length === 0
        ? "BASARILI - yedekteki, geri yuklenen ve canli satir sayilari birebir ayni"
        : `DIKKAT - ${uyusmayan.length} tabloda fark var (yedek alindiktan sonra veri degismis olabilir)`,
      ayrinti: satirlar,
      uyusmayan,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
