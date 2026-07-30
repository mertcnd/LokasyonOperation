-- Marka bazlı görünürlük izni
-- Supabase > SQL Editor'de bir kez çalıştırın.
--
-- "sekmeler" sütunuyla aynı biçim kullanılır: text sütunda JSON dizi metni,
-- örn. '["Bim","Hikmet"]'. Boş/NULL = kısıt yok (kullanıcı tüm markaları görür),
-- böylece mevcut kullanıcılar bu değişiklikten etkilenmez.

ALTER TABLE kullanicilar
  ADD COLUMN IF NOT EXISTS markalar text;

-- Kontrol: sütun eklendi mi?
-- select kullanici_adi, rol, sekmeler, markalar from kullanicilar;
