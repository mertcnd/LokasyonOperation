-- Marka bazlı renk
-- Supabase > SQL Editor'de bir kez çalıştırın.
--
-- Değer, HEX renk kodudur: '#1565c0' gibi. NULL/boş bırakılan markalara
-- uygulama marka adından üretilen sabit bir palet rengi atar; yani bu sütun
-- eklenmeden de renkler çalışır, sütun yalnızca "rengi elle seçebilme"
-- özelliğini açar.

ALTER TABLE markalar
  ADD COLUMN IF NOT EXISTS renk text;

-- Kontrol:
-- select ad, renk from markalar order by ad;
