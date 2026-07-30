-- Görevlerde "kimin oluşturduğu" bilgisi
-- Supabase > SQL Editor'de bir kez çalıştırın.
--
-- Personel yalnızca kendi girdiği veya kendisine atanan görevleri görebilsin
-- diye gerekli. Değer, personelin ADIDIR ("todos.atanan" ile aynı biçim).
--
-- Mevcut kayıtlarda bu alan boş kalır; boş olanlar herkese görünmeye devam
-- eder (eski işler erişilemez hâle gelmesin diye bilinçli tercih).

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS olusturan text;

-- Kontrol:
-- select baslik, atanan, olusturan from todos order by olusturan nulls first;
