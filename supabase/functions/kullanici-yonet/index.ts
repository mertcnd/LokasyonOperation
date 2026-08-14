import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

/*
  Kullanici hesabi yonetimi (Auth).

  Auth hesabi acmak, sifre degistirmek ve hesap silmek servis anahtari
  gerektirir; panel bu anahtari asla goremez. Bu yuzden islemler burada.

  YETKI: yalnizca gecerli bir Auth jetonu olan ve profili rol='admin' olan
  kullanici cagirabilir. Jetonsuz cagri kabul edilmez -- bu fonksiyonun
  kotuye kullanimi dogrudan yonetici hesabi uretmek anlamina gelirdi.

  Islemler:
    olustur : yeni Auth hesabi + kullanicilar satiri
    bagla   : mevcut kullanicilar satirina Auth hesabi acar (gecis gunu)
    sifre   : sifre degistirir
    sil     : Auth hesabini ve kullanicilar satirini siler
*/

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SRV_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (g: unknown, s = 200) =>
  new Response(JSON.stringify(g), { status: s, headers: { ...cors, "Content-Type": "application/json" } })

const srv = { apikey: SRV_KEY, Authorization: `Bearer ${SRV_KEY}`, "Content-Type": "application/json" }

type Kullanici = {
  id: string; kullanici_adi?: string; ad_soyad?: string; email?: string
  rol?: string; auth_uid?: string | null
}

async function rest<T>(yol: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${yol}`, { headers: srv })
  if (!r.ok) throw new Error(`${yol} okunamadi (${r.status})`)
  return await r.json() as T[]
}

// Cagiran gercekten yonetici mi?
async function yoneticiMi(req: Request): Promise<boolean> {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!jeton || jeton === ANON_KEY || jeton.startsWith("sb_publishable_")) return false
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) return false
  const u = await r.json() as { id?: string }
  if (!u.id) return false
  const satir = await rest<Kullanici>(`kullanicilar?auth_uid=eq.${u.id}&select=rol`)
  return satir[0]?.rol === "admin"
}

async function authHesapAc(email: string, sifre: string, ad: string) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST", headers: srv,
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password: sifre,
      email_confirm: true,               // dogrulama maili beklenmez
      user_metadata: { ad_soyad: ad },
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.msg || j.message || `Auth hesabi acilamadi (${r.status})`)
  return j.id as string
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    if (!await yoneticiMi(req)) return json({ error: "Bu islem icin yonetici yetkisi gerekir" }, 403)

    const govde = await req.json()
    const islem = String(govde.islem || "")

    // ── Mevcut satira Auth hesabi ac ve bagla ───────────────────────────────
    if (islem === "bagla") {
      const satir = await rest<Kullanici>(`kullanicilar?id=eq.${encodeURIComponent(govde.id)}&select=*`)
      const k = satir[0]
      if (!k) return json({ error: "Kullanici bulunamadi" }, 404)
      if (k.auth_uid) return json({ error: "Bu hesabin Auth kaydi zaten var" }, 409)
      if (!k.email) return json({ error: "Once kullaniciya e-posta adresi tanimlayin" }, 400)
      if (!govde.sifre || String(govde.sifre).length < 8) {
        return json({ error: "Sifre en az 8 karakter olmalidir" }, 400)
      }
      const uid = await authHesapAc(k.email, govde.sifre, k.ad_soyad || k.kullanici_adi || "")
      await fetch(`${SB_URL}/rest/v1/kullanicilar?id=eq.${encodeURIComponent(k.id)}`, {
        method: "PATCH", headers: { ...srv, Prefer: "return=minimal" },
        body: JSON.stringify({ auth_uid: uid, sifre_hash: null }),
      })
      return json({ success: true, auth_uid: uid })
    }

    // ── Yeni kullanici ──────────────────────────────────────────────────────
    if (islem === "olustur") {
      const p = govde.profil || {}
      if (!govde.email || !govde.sifre) return json({ error: "E-posta ve sifre zorunlu" }, 400)
      if (String(govde.sifre).length < 8) return json({ error: "Sifre en az 8 karakter olmalidir" }, 400)
      const uid = await authHesapAc(govde.email, govde.sifre, p.ad_soyad || "")
      const satir = { ...p, id: p.id || crypto.randomUUID(), email: String(govde.email).trim().toLowerCase(), auth_uid: uid }
      const r = await fetch(`${SB_URL}/rest/v1/kullanicilar`, {
        method: "POST", headers: { ...srv, Prefer: "return=minimal" },
        body: JSON.stringify(satir),
      })
      if (!r.ok) {
        // Profil yazilamadiysa yetim Auth hesabi birakma
        await fetch(`${SB_URL}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: srv })
        return json({ error: `Profil kaydedilemedi (${r.status})` }, 500)
      }
      return json({ success: true, id: satir.id, auth_uid: uid })
    }

    // ── Sifre degistir ──────────────────────────────────────────────────────
    if (islem === "sifre") {
      if (!govde.sifre || String(govde.sifre).length < 8) {
        return json({ error: "Sifre en az 8 karakter olmalidir" }, 400)
      }
      const satir = await rest<Kullanici>(`kullanicilar?id=eq.${encodeURIComponent(govde.id)}&select=*`)
      const k = satir[0]
      if (!k) return json({ error: "Kullanici bulunamadi" }, 404)
      if (!k.auth_uid) return json({ error: "Bu hesabin Auth kaydi yok" }, 400)
      const r = await fetch(`${SB_URL}/auth/v1/admin/users/${k.auth_uid}`, {
        method: "PUT", headers: srv, body: JSON.stringify({ password: govde.sifre }),
      })
      if (!r.ok) return json({ error: `Sifre degistirilemedi (${r.status})` }, 500)
      return json({ success: true })
    }

    // ── Sil ─────────────────────────────────────────────────────────────────
    if (islem === "sil") {
      const satir = await rest<Kullanici>(`kullanicilar?id=eq.${encodeURIComponent(govde.id)}&select=*`)
      const k = satir[0]
      if (!k) return json({ error: "Kullanici bulunamadi" }, 404)
      if (k.auth_uid) {
        await fetch(`${SB_URL}/auth/v1/admin/users/${k.auth_uid}`, { method: "DELETE", headers: srv })
      }
      await fetch(`${SB_URL}/rest/v1/kullanicilar?id=eq.${encodeURIComponent(k.id)}`, {
        method: "DELETE", headers: { ...srv, Prefer: "return=minimal" },
      })
      return json({ success: true })
    }

    return json({ error: "Bilinmeyen islem" }, 400)
  } catch (err) {
    console.error(err)
    return json({ error: (err as Error).message }, 500)
  }
})
