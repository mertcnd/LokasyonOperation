from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageEnhance
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "gorseller"
TMP = ROOT / "tmp" / "pdfs" / "generated"
OUT = ROOT / "output" / "pdf"
TMP.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = landscape(A4)

NAVY = HexColor("#14297A")
BLUE = HexColor("#1565C0")
SKY = HexColor("#EAF3FF")
ORANGE = HexColor("#FF8F00")
ORANGE_BG = HexColor("#FFF7E6")
GREEN = HexColor("#2E7D32")
GREEN_BG = HexColor("#EAF6EC")
RED = HexColor("#C62828")
RED_BG = HexColor("#FFF0F0")
INK = HexColor("#1D2533")
MUTED = HexColor("#667085")
LINE = HexColor("#DCE3EE")
PANEL = HexColor("#F6F8FC")
PURPLE = HexColor("#6B3FA0")

FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
pdfmetrics.registerFont(TTFont("GuideSans", FONT_REG))
pdfmetrics.registerFont(TTFont("GuideSans-Bold", FONT_BOLD))


def style(size=10, color=INK, leading=None, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        "guide",
        fontName="GuideSans-Bold" if bold else "GuideSans",
        fontSize=size,
        leading=leading or size * 1.32,
        textColor=color,
        alignment=align,
        spaceAfter=0,
        spaceBefore=0,
    )


def paragraph(c, text, x, y_top, w, h=200, size=10, color=INK, bold=False, leading=None, align=TA_LEFT):
    p = Paragraph(text, style(size=size, color=color, bold=bold, leading=leading, align=align))
    pw, ph = p.wrap(w, h)
    p.drawOn(c, x, y_top - ph)
    return ph


def rounded_box(c, x, y, w, h, fill=white, stroke=LINE, radius=10, sw=0.8):
    c.setLineWidth(sw)
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def pill(c, x, y, text, fill=SKY, color=BLUE, pad_x=9, h=19, size=8.5):
    tw = pdfmetrics.stringWidth(text, "GuideSans-Bold", size)
    w = tw + pad_x * 2
    c.setFillColor(fill)
    c.setStrokeColor(fill)
    c.roundRect(x, y, w, h, h / 2, fill=1, stroke=0)
    c.setFillColor(color)
    c.setFont("GuideSans-Bold", size)
    c.drawString(x + pad_x, y + (h - size) / 2 + 1, text)
    return w


def page_base(c, section, title, subtitle, page_no, total, audience="EKİP & YÖNETİCİ"):
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 12, PAGE_W, 12, fill=1, stroke=0)

    c.setFont("GuideSans-Bold", 10)
    c.setFillColor(NAVY)
    c.drawString(30, PAGE_H - 38, "LOKASYON")
    c.setFillColor(BLUE)
    c.drawString(30, PAGE_H - 50, "İSTANBUL")

    c.setFont("GuideSans-Bold", 7.5)
    c.setFillColor(ORANGE)
    c.drawString(128, PAGE_H - 35, section.upper())
    c.setFillColor(INK)
    c.setFont("GuideSans-Bold", 21)
    c.drawString(128, PAGE_H - 57, title)
    c.setFillColor(MUTED)
    c.setFont("GuideSans", 8.5)
    c.drawRightString(PAGE_W - 30, PAGE_H - 36, audience)
    c.drawRightString(PAGE_W - 30, PAGE_H - 50, subtitle)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(30, PAGE_H - 70, PAGE_W - 30, PAGE_H - 70)

    c.setFillColor(MUTED)
    c.setFont("GuideSans", 7.8)
    c.drawString(30, 17, "Lokasyon Operasyon Paneli · Kullanıcı kılavuzu · Eylül 2026")
    c.drawRightString(PAGE_W - 30, 17, f"{page_no} / {total}")


def draw_cover(c, title, subtitle, audience, version, accent, total, customer=False):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(accent)
    c.circle(PAGE_W - 95, PAGE_H - 85, 160, fill=1, stroke=0)
    c.setFillColor(Color(1, 1, 1, alpha=0.08))
    c.circle(PAGE_W - 40, 60, 190, fill=1, stroke=0)
    c.circle(35, PAGE_H - 35, 120, fill=1, stroke=0)

    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 18)
    c.drawString(52, PAGE_H - 72, "LOKASYON")
    c.setFillColor(SKY)
    c.drawString(52, PAGE_H - 93, "İSTANBUL")
    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 8.5)
    c.drawString(54, PAGE_H - 112, "OPERASYON PANELİ")

    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 34)
    y = 330
    for line in title.split("\n"):
        c.drawString(52, y, line)
        y -= 40
    c.setFillColor(SKY)
    paragraph(c, subtitle, 54, y - 7, 475, h=90, size=13, color=SKY, leading=18)

    label = "MÜŞTERİ" if customer else "EKİP & YÖNETİCİ"
    pill(c, 54, 105, label, fill=white, color=NAVY, pad_x=14, h=25, size=10)
    c.setFillColor(white)
    c.setFont("GuideSans", 9)
    c.drawString(54, 78, f"Sürüm {version} · Eylül 2026 · {total} sayfa")
    c.drawString(54, 58, audience)

    # Three visual anchors on the cover.
    x0 = PAGE_W - 300
    cards = [
        ("01", "İşi bul", "Kartı ve bekleyen adımı aç"),
        ("02", "Dosyaları kontrol et", "Kartta duran güncel dosyaları aç"),
        ("03", "Kararı kaydet", "Onay veya açık revizyon notu"),
    ]
    for i, (num, head, body) in enumerate(cards):
        yy = 335 - i * 94
        c.setFillColor(Color(1, 1, 1, alpha=0.94))
        c.setStrokeColor(white)
        c.roundRect(x0, yy, 240, 70, 12, fill=1, stroke=0)
        c.setFillColor(accent)
        c.setFont("GuideSans-Bold", 20)
        c.drawString(x0 + 16, yy + 37, num)
        c.setFillColor(NAVY)
        c.setFont("GuideSans-Bold", 11)
        c.drawString(x0 + 58, yy + 42, head)
        c.setFillColor(MUTED)
        c.setFont("GuideSans", 8.5)
        c.drawString(x0 + 58, yy + 24, body)


def image_contain(c, path, x, y, w, h, bg=white, pad=6, caption=None):
    rounded_box(c, x, y, w, h, fill=bg, stroke=LINE, radius=10)
    path = Path(path)
    if not path.exists():
        c.setFillColor(MUTED)
        c.setFont("GuideSans", 9)
        c.drawCentredString(x + w / 2, y + h / 2, "Ekran görüntüsü hazırlanamadı")
        return
    img = Image.open(path)
    iw, ih = img.size
    cap_h = 20 if caption else 0
    avail_w, avail_h = w - pad * 2, h - pad * 2 - cap_h
    scale = min(avail_w / iw, avail_h / ih)
    dw, dh = iw * scale, ih * scale
    dx = x + (w - dw) / 2
    dy = y + pad + cap_h + (avail_h - dh) / 2
    c.drawImage(ImageReader(img), dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")
    if caption:
        c.setFillColor(MUTED)
        c.setFont("GuideSans", 7.3)
        c.drawString(x + 10, y + 8, caption)


def numbered_step(c, n, title, text, x, y_top, w, accent=BLUE, h=61):
    rounded_box(c, x, y_top - h, w, h, fill=white, stroke=LINE, radius=10)
    c.setFillColor(accent)
    c.circle(x + 25, y_top - h / 2, 14, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 10)
    c.drawCentredString(x + 25, y_top - h / 2 - 3, str(n))
    c.setFillColor(INK)
    c.setFont("GuideSans-Bold", 10)
    c.drawString(x + 48, y_top - 22, title)
    paragraph(c, text, x + 48, y_top - 31, w - 62, h=30, size=8.2, color=MUTED, leading=10.5)


def callout(c, title, text, x, y, w, h, kind="info"):
    palette = {
        "info": (SKY, BLUE),
        "warn": (ORANGE_BG, ORANGE),
        "ok": (GREEN_BG, GREEN),
        "danger": (RED_BG, RED),
    }
    bg, accent = palette[kind]
    rounded_box(c, x, y, w, h, fill=bg, stroke=accent, radius=9, sw=0.8)
    c.setFillColor(accent)
    c.rect(x, y, 5, h, fill=1, stroke=0)
    c.setFillColor(accent)
    c.setFont("GuideSans-Bold", 9.5)
    c.drawString(x + 16, y + h - 20, title)
    paragraph(c, text, x + 16, y + h - 28, w - 30, h - 32, size=8.2, color=INK, leading=10.7)


def mini_card(c, title, text, x, y, w, h, accent=BLUE, tag=None):
    rounded_box(c, x, y, w, h, fill=white, stroke=LINE, radius=10)
    c.setFillColor(accent)
    c.rect(x, y + h - 5, w, 5, fill=1, stroke=0)
    if tag:
        pill(c, x + 14, y + h - 31, tag, fill=PANEL, color=accent, pad_x=8, h=18, size=7.6)
        title_y = y + h - 47
    else:
        title_y = y + h - 23
    c.setFillColor(INK)
    c.setFont("GuideSans-Bold", 10)
    c.drawString(x + 14, title_y, title)
    paragraph(c, text, x + 14, title_y - 9, w - 28, h - 43, size=8.2, color=MUTED, leading=10.6)


def flow_node(c, x, y, w, h, title, sub, color, status=None):
    rounded_box(c, x, y, w, h, fill=white, stroke=color, radius=9, sw=1.1)
    c.setFillColor(color)
    c.circle(x + 22, y + h / 2, 11, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("GuideSans-Bold", 8)
    c.drawCentredString(x + 22, y + h / 2 - 3, status or "✓")
    c.setFillColor(INK)
    c.setFont("GuideSans-Bold", 9)
    c.drawString(x + 40, y + h - 20, title)
    c.setFillColor(MUTED)
    c.setFont("GuideSans", 7.5)
    c.drawString(x + 40, y + 13, sub)


def arrow(c, x1, y1, x2, y2, color=LINE):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.4)
    c.line(x1, y1, x2, y2)
    c.line(x2, y2, x2 - 6, y2 + 4)
    c.line(x2, y2, x2 - 6, y2 - 4)


def page_daily_routine(c, p, total):
    page_base(c, "Başlangıç", "Panelde günlük çalışma düzeni", "Önce riskleri gör, sonra doğru kartta ilerle", p, total)
    numbered_step(c, 1, "Günlük Durum’u aç", "Bugünkü işler, revizyonlar ve gecikme riskleri tek yerde toplanır.", 34, 492, 360, accent=BLUE)
    numbered_step(c, 2, "Filtreyi daralt", "Tarih, marka ve kişi filtrelerini seç; ardından eylem grubuna geç.", 34, 418, 360, accent=PURPLE)
    numbered_step(c, 3, "İşi aç ve bilgileri kontrol et", "Sorumlu, hedef tarih ve adım durumunu oku.", 34, 344, 360, accent=ORANGE)
    numbered_step(c, 4, "İşi kaydet ve kapat", "Süreyi, notu, dosyayı veya kararı kaydet; durumun gerçekten değiştiğini doğrula.", 34, 270, 360, accent=GREEN)
    callout(c, "60 saniyelik başlangıç kontrolü", "Bildirim zili → RET durumundaki adımlar → hedef tarihi bugün veya geçmiş olanlar → kendi adınıza filtrelenmiş liste.", 34, 103, 360, 86, "info")

    rounded_box(c, 418, 105, 389, 387, fill=PANEL, stroke=LINE, radius=14)
    c.setFillColor(NAVY)
    c.setFont("GuideSans-Bold", 13)
    c.drawString(440, 462, "Üst menü: hangi bölüm ne için?")
    menu = [
        ("Günlük Durum", "Öncelik ve aksiyon listesi"),
        ("Görevler (To Do)", "Kişisel ve ekip içi görevler"),
        ("Ürün Kartları", "İşin ana kaydı, adımlar ve dosyalar"),
        ("Raporlama", "Görev, kapasite, gelir ve maliyet"),
        ("Arşiv", "Kapanmış iş ve adımlar"),
        ("Maliyet", "Yetkili kullanıcı için maliyet görünümü"),
        ("Veri Yönetimi", "Kullanıcı, marka ve iş türü ayarları"),
        ("Asistan", "Panel içi hızlı yardım"),
    ]
    yy = 427
    for i, (name, desc) in enumerate(menu):
        col = i % 2
        row = i // 2
        x = 440 + col * 180
        y = yy - row * 79
        c.setFillColor(white)
        c.setStrokeColor(LINE)
        c.roundRect(x, y - 48, 165, 58, 8, fill=1, stroke=1)
        c.setFillColor(BLUE if i in (0, 2, 3) else NAVY)
        c.setFont("GuideSans-Bold", 9)
        c.drawString(x + 11, y - 10, name)
        paragraph(c, desc, x + 11, y - 19, 143, 28, size=7.5, color=MUTED, leading=9.3)


def page_daily_groups(c, p, total):
    page_base(c, "Günlük Durum", "Neye önce bakmalıyım?", "Filtreler günlük listeyi kendi işinize daraltır", p, total)
    image_contain(c, IMAGES / "ss-gunluk.png", 34, 86, 510, 400, caption="Günlük Durum · örnek veriler")
    labels = [
        ("Tarih aralığı", "Varsayılan olarak içinde bulunulan ay; istediğiniz aralığı seçin.", BLUE),
        ("Marka", "Yalnız seçtiğiniz markanın işleri listelenir.", PURPLE),
        ("Kişi", "Kendi adınızı seçerek yalnız size atanmış işleri görün.", GREEN),
        ("Durum menüsü", "Satırdan doğrudan Bekliyor / Devam Ediyor / Tamamlandı / RET.", ORANGE),
        ("RET satırları", "Müşteriden düzeltme dönen işler; önce bunlara bakın.", RED),
    ]
    y = 475
    for i2, (head, body, accent) in enumerate(labels):
        mini_card(c, head, body, 565, y - 68, 242, 58, accent=accent, tag=str(i2 + 1))
        y -= 76
    callout(c, "Adım kilidi", "Bir adımı yalnızca atandığı kişi veya yönetici değiştirebilir. Başkasının adımına dokunmaya çalışırsanız panel uyarı verir; notlar herkese açıktır.", 565, 86, 242, 82, "warn")


def page_product_cards(c, p, total):
    page_base(c, "Ürün Kartları", "Kartı bulma, açma ve güncel tutma", "Her çalışma tek kartta izlenir", p, total)
    image_contain(c, IMAGES / "ss-urun.png", 34, 120, 480, 360, caption="Ürün Kartları · liste ve filtreler")
    numbered_step(c, 1, "Filtrele", "Marka, durum veya metin aramasını kullan.", 536, 480, 271, h=55)
    numbered_step(c, 2, "Kartı aç", "Kart adı, hedef tarih ve ilerleme bilgisini kontrol et.", 536, 414, 271, h=55)
    numbered_step(c, 3, "Adımları sırayla yürüt", "Durum, sorumlu, hedef tarih ve süre alanlarını güncelle.", 536, 348, 271, h=55)
    numbered_step(c, 4, "Dosyayı doğru seriye yükle", "Yeni belge ile yeni sürüm seçeneklerini karıştırma.", 536, 282, 271, h=55)
    numbered_step(c, 5, "Kapat veya arşivle", "İş tamamlandıktan sonra kartı arşive taşı.", 536, 216, 271, h=55)
    callout(c, "Kart adı ve marka", "Kartın adı, müşterinin de göreceği bağlamdır. Kısa, ayırt edici ve dosya adıyla tutarlı yazın.", 536, 102, 271, 83, "info")


def page_revision(c, p, total):
    page_base(c, "Revizyon", "Müşteri düzeltme istediğinde", "Bildirim işi yapan kişiye gider", p, total)
    flow_y = 357
    flow = [
        ("Müşteri", "Revizyon İstiyorum", RED, "1"),
        ("Onay adımı", "RET durumuna geçer", ORANGE, "2"),
        ("Önceki adım", "Sahibine zil + e-posta", BLUE, "3"),
        ("Ekip", "Düzeltir, dosyayı yeniler", PURPLE, "4"),
        ("Onay adımı", "Yeniden Bekliyor yapılır", GREEN, "5"),
    ]
    x = 29
    for i2, node in enumerate(flow):
        flow_node(c, x, flow_y, 141, 68, *node)
        if i2 < len(flow) - 1:
            arrow(c, x + 141, flow_y + 34, x + 155, flow_y + 34, color=HexColor("#A9B6C8"))
        x += 156
    callout(c, "Bildirim kime gider?", "Kartta <b>bir önceki</b> atanmış adımın sahibine. Onay adımı bir kontrol noktasıdır; düzeltilecek iş ondan önce yapılmıştır. Müşterinin belge üzerindeki açık not sayısı da bildirilir.", 34, 224, 369, 94, "info")
    callout(c, "Üretim adımı kendiliğinden açılmaz", "Tamamlanmış adımı hangi düzeltmenin karşılayacağına ekip karar verir ve o adımı elle RET veya Devam Ediyor yapar.", 421, 224, 386, 94, "warn")
    mini_card(c, "İyi revizyon notu", "“Ön yüzdeki barkodu 5 mm büyütün; sağ alt köşedeki eski tarih kalksın.”", 34, 91, 238, 96, accent=GREEN, tag="AÇIK")
    mini_card(c, "Zayıf revizyon notu", "“Olmamış, tekrar bakın.” Ne düzeltileceği ve başarı ölçütü belli değildir.", 301, 91, 238, 96, accent=RED, tag="BELİRSİZ")
    mini_card(c, "Kapanış kontrolü", "Eski dosyayı silin, yenisini yükleyin ve onay adımını Bekliyor durumuna alın.", 568, 91, 239, 96, accent=BLUE, tag="SON ADIM")


def page_annotations(c, p, total):
    page_base(c, "Belge Notları", "PDF ve görseller üzerinde çalışmak", "Notları belgeye ve doğru sürüme bağlayın", p, total)
    image_contain(c, IMAGES / "ss-dokuman.png", 34, 95, 520, 390, caption="Belge notları / işaretleme görünümü · örnek veriler")
    numbered_step(c, 1, "Belgeyi aç", "Belge satırındaki Notlar düğmesini kullan.", 575, 484, 232, h=54)
    numbered_step(c, 2, "Noktayı seç", "İşareti değişikliğin yapılacağı yere koy.", 575, 420, 232, h=54)
    numbered_step(c, 3, "Açık tarif yaz", "Ne değişecek, nasıl görünecek, gerekiyorsa ölçüyü belirt.", 575, 356, 232, h=54)
    numbered_step(c, 4, "Durumu takip et", "Açık notlar çözülene kadar belge kapanmış sayılmaz.", 575, 292, 232, h=54)
    callout(c, "Sürüm değiştiğinde", "Yeni sürüm yüklenince önceki sürüm ve üzerindeki notlar korunur. Yeni dosyada düzeltmelerin uygulandığını kontrol edin.", 575, 171, 232, 89, "info")
    callout(c, "Erişim", "Müşteri kendi işaretlerini görür. Ekip içi çalışma ayrıntıları müşteri görünümüne taşınmaz.", 575, 95, 232, 60, "ok")


def page_reporting(c, p, total):
    page_base(c, "Raporlama", "Süreyi, beklemeyi ve revizyonu okumak", "Filtreler rapor kapsamını belirler", p, total)
    # Ekran görüntüsü çerçevesinin içinde üstte/altta boşluk kalıyordu; çerçeve
    # kısaltılıp uyarı kutusu görselin altına alındı. Eskiden kutu sağ sütunda
    # "Üretim emeği" kartının üstüne biniyor, kartın açıklamasını örtüyordu.
    image_contain(c, IMAGES / "ss-rapor.png", 34, 150, 472, 335, caption="Raporlama ekranı · örnek veriler")
    metrics = [
        ("Zamanında tamamlanan", "Hedef tarihe kadar kapanan ölçülebilir adımların oranı.", GREEN),
        ("Ort. müşteri bekleme", "Sunum ile müşteri kararı arasındaki takvim saati.", ORANGE),
        ("En uzun açık onay", "Hâlâ bekleyen onaylar içindeki en eski süre.", RED),
        ("Revizyon emeği", "Revizyon turlarında üretime harcanan fiili süre.", PURPLE),
        ("Üretim emeği", "Sayaç veya elle girilmiş fiili toplam; revizyon dahil.", BLUE),
        ("Gelir ve personel maliyeti", "Görev ve Kapasite kartlarında; Maliyet yetkisiyle.", GREEN),
    ]
    # Altı kart ancak 61 pt adımla sığar; kart açıklaması tek satır kalmalı
    # (mini_card gövdesi 54 pt yükseklikte yalnızca bir satır gösterir).
    y = 485
    for title, body, accent in metrics:
        mini_card(c, title, body, 528, y - 64, 279, 54, accent=accent)
        y -= 61
    callout(c, "Karşılaştırırken", "Aynı tarih, marka, kişi ve kart filtrelerini kullanın; görev geliri ve personel maliyeti de bu filtrelere uyar. Eski veya hedef tarihi olmayan kayıtlar bazı oranlarda ‘bilinmeyen’ sayılabilir.", 34, 86, 472, 56, "warn")


def page_roles(c, p, total):
    page_base(c, "Yetki ve Modüller", "Kim neyi görebilir?", "Müşteri görünümü üretim ayrıntılarını göstermez", p, total)
    rows = [
        ("Alan", "Personel", "Yönetici", "Müşteri"),
        ("Atandığı üretim adımı", "Düzenler", "Düzenler", "Görmez"),
        ("Kullanıcı ve yetki ayarları", "Görmez", "Yönetir", "Görmez"),
        ("Dosya yükleme / sürüm", "Yetkisi varsa", "Yönetir", "İndirir"),
        ("Müşteri onay adımı", "Hazırlar", "Yönetir", "Karar verir"),
        ("Süre / maliyet / personel", "Kendi işi", "Yetkili görünüm", "Görmez"),
        ("Rapor", "Yetkisi kadar", "Tüm yetkili kapsam", "Kendi markası"),
    ]
    x0, y0 = 34, 467
    widths = [235, 175, 175, 175]
    row_h = 43
    for r, row in enumerate(rows):
        x = x0
        for col, text in enumerate(row):
            fill = NAVY if r == 0 else (PANEL if r % 2 == 0 else white)
            c.setFillColor(fill)
            c.setStrokeColor(LINE)
            c.rect(x, y0 - row_h * (r + 1), widths[col], row_h, fill=1, stroke=1)
            c.setFillColor(white if r == 0 else (INK if col == 0 else MUTED))
            c.setFont("GuideSans-Bold" if r == 0 or col == 0 else "GuideSans", 8.6)
            c.drawString(x + 10, y0 - row_h * r - 27, text)
            x += widths[col]
    callout(c, "Yetki sorunu yaşarsanız", "Önce doğru kullanıcıyla giriş yaptığınızı ve kartın doğru markaya bağlı olduğunu kontrol edin. Yetki değişikliğini yönetici Veri Yönetimi bölümünden yapar.", 34, 80, 366, 72, "info")
    callout(c, "Müşteri gizliliği", "Müşteri; personel adı, çalışma süresi, maliyet ve ekip içi operasyon alanlarını görmez. Yalnızca kendi markasına ait kart ve dosyalara erişir.", 420, 80, 387, 72, "ok")


def page_troubleshooting(c, p, total):
    page_base(c, "Sorun Çözme", "Hızlı karar tablosu", "Önce durumun hangi aşamada olduğunu belirleyin", p, total)
    items = [
        ("Dosyayı yanlış yükledim", "Onaya hiç sunulmadıysa Belgeler’deki çöp kutusunu kullan.", "ok"),
        ("Yanlış dosyayı müşteriye gösterdim", "Dosyayı Dokümanlar bölümünden silin ve doğrusunu yükleyin. Müşteri kartta o an duran dosyaları görür.", "warn"),
        ("Adımı değiştiremiyorum", "Adım size atanmış mı bakın; yalnız atanan kişi veya yönetici değiştirebilir.", "danger"),
        ("Dosya silinmiyor", "Sayfayı yenileyip tekrar dene; sürerse depolama yetkini kontrol ettir.", "info"),
        ("Müşteri onay alanını görmüyor", "Adımda “Müşteri onaylar” işaretli mi, durumu Bekliyor mu ve kart markası müşteri hesabına tanımlı mı kontrol et.", "info"),
        ("Eski ekran görünüyor", "Alt kısımdaki Panel güncellendi şeridinde Yenile’ye bas veya sayfayı yenile.", "ok"),
        ("Bildirim gelmedi", "Zili, adım atamasını ve kullanıcı e-posta/personel bağlantısını kontrol et.", "warn"),
        ("Karar veya işlem hata verdi", "Sayfayı yenileyip tekrar dene. Aynı kararı ikinci kez göndermeye çalışma.", "danger"),
    ]
    x_positions = [34, 421]
    y_positions = [420, 315, 210, 105]
    for i, (head, body, kind) in enumerate(items):
        col = i % 2
        row = i // 2
        callout(c, head, body, x_positions[col], y_positions[row], 368, 88, kind)
    c.setFillColor(MUTED)
    c.setFont("GuideSans", 7.8)
    c.drawCentredString(PAGE_W / 2, 69, "Destek isterken kart adını, adım adını, görünen uyarı metnini ve işlemin saatini paylaşın.")


def build_general(path: Path):
    total = 9
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("Lokasyon Operasyon Paneli - Ekip ve Yönetici Kullanım Kılavuzu")
    c.setAuthor("Lokasyon İstanbul")
    draw_cover(c, "EKİP VE YÖNETİCİ\nKULLANIM KILAVUZU", "Günlük iş takibinden müşteri onayına kadar panelin güncel iş akışı.", "İç kullanım için hazırlanmıştır.", "9bc6f3e66826", BLUE, total)
    c.showPage()
    page_daily_routine(c, 2, total); c.showPage()
    page_daily_groups(c, 3, total); c.showPage()
    page_product_cards(c, 4, total); c.showPage()
    page_revision(c, 5, total); c.showPage()
    page_annotations(c, 6, total); c.showPage()
    page_reporting(c, 7, total); c.showPage()
    page_roles(c, 8, total); c.showPage()
    page_troubleshooting(c, 9, total); c.showPage()
    c.save()


def customer_page_nav(c, p, total):
    page_base(c, "Başlangıç", "Giriş ve güvenli kullanım", "Hesabınız yalnızca yetkili markaları gösterir", p, total, audience="MÜŞTERİ")
    image_contain(c, IMAGES / "m-giris.png", 34, 112, 430, 370, caption="Müşteri giriş ekranı · örnek veriler")
    numbered_step(c, 1, "Size verilen adresi açın", "Panel bağlantısını tarayıcınızda açın.", 486, 480, 321, h=56, accent=BLUE)
    numbered_step(c, 2, "Kullanıcı adı ve şifreyle giriş yapın", "Şifrenizi ekip dışındaki kişilerle paylaşmayın.", 486, 412, 321, h=56, accent=PURPLE)
    numbered_step(c, 3, "Ürün Kartları’nı kullanın", "Size bağlı markaların çalışma kartları burada görünür.", 486, 344, 321, h=56, accent=ORANGE)
    numbered_step(c, 4, "İşiniz bitince Çıkış’a basın", "Ortak bilgisayarda tarayıcıyı kapatmak tek başına yeterli değildir.", 486, 276, 321, h=56, accent=GREEN)
    callout(c, "Neleri görürsünüz?", "Üç bölüm vardır: <b>İş Takibi</b>, <b>Ürün Kartları</b> ve <b>Rapor</b>. Yalnızca kendi markanızın kayıtları görünür; personel, süre ve maliyet gösterilmez.", 486, 153, 321, 91, "info")
    callout(c, "Erişim sorunu", "Kart eksikse ekipten kartın marka bağlantısını ve hesabınıza tanımlı markaları kontrol etmesini isteyin.", 486, 89, 321, 48, "warn")


def customer_page_find(c, p, total):
    page_base(c, "Ürün Kartları", "Bir çalışmayı bulma ve açma", "Kart adı ve marka ile doğru işi seçin", p, total, audience="MÜŞTERİ")
    image_contain(c, IMAGES / "m-urun.png", 34, 100, 510, 385, caption="Müşteri Ürün Kartları görünümü · örnek veriler")
    numbered_step(c, 1, "Arama veya filtreyi kullanın", "Kart adı, marka veya durumla listeyi daraltın.", 566, 480, 241, h=58)
    numbered_step(c, 2, "Kart başlığını kontrol edin", "Benzer adlarda doğru marka ve çalışma adını seçin.", 566, 410, 241, h=58)
    numbered_step(c, 3, "Kartı açın", "İş Akışı, Belgeler ve varsa onay alanı görünür.", 566, 340, 241, h=58)
    callout(c, "Durumları okumak", "<b>Bekliyor:</b> sırada · <b>Devam Ediyor:</b> ekip çalışıyor · <b>Tamamlandı:</b> adım kapandı · <b>RET:</b> düzeltme turu açık.", 566, 211, 241, 101, "info")
    callout(c, "Karar alanı ne zaman hazır?", "Adımda <b>Onaylıyorum / Revizyon İstiyorum</b> düğmeleri görünüyorsa karar sizden bekleniyordur. Düğmeler yoksa adım henüz size gelmemiş ya da karar verilmiştir.", 566, 100, 241, 91, "warn")


def customer_page_decision(c, p, total):
    page_base(c, "Karar", "Onay mı, revizyon mu?", "Kararı kaydetmeden önce dosyayı açıp kontrol edin", p, total, audience="MÜŞTERİ")
    mini_card(c, "Onaylıyorum", "Dosyalar beklentinizi karşılıyorsa seçin. Sistem onay adımını tamamlar ve çalışma bir sonraki aşamaya geçer.", 34, 302, 361, 177, accent=GREEN, tag="DOSYA UYGUN")
    mini_card(c, "Revizyon İstiyorum", "Düzeltme gerekiyorsa seçin. Görüş alanına neyin, nerede ve nasıl değişmesi gerektiğini yazmak zorunludur.", 412, 302, 395, 177, accent=RED, tag="DÜZELTME GEREKLİ")
    c.setFillColor(HexColor("#A9B6C8"))
    c.setLineWidth(2)
    c.line(PAGE_W / 2, 280, PAGE_W / 2, 214)
    arrow(c, PAGE_W / 2, 214, 250, 214, color=HexColor("#A9B6C8"))
    arrow(c, PAGE_W / 2, 214, 590, 214, color=HexColor("#A9B6C8"))
    callout(c, "Onay sonucu", "Onay kaydedilir, adım Tamamlandı olur; aynı adımda ikinci karar verilemez.", 73, 114, 305, 82, "ok")
    callout(c, "Revizyon sonucu", "Not ekibe gider; onay adımı RET olur ve işi yapan kişiye bildirim gönderilir.", 462, 114, 305, 82, "danger")
    c.setFillColor(ORANGE)
    c.setFont("GuideSans-Bold", 9.5)
    c.drawCentredString(PAGE_W / 2, 83, "Karar sonrası değişiklik gerekiyorsa kart adıyla ekibe ulaşın.")


def customer_page_comments(c, p, total):
    page_base(c, "Belgeler", "Dosyayı açma ve işaretleme", "Yorumunuzu doğru belge ve noktaya bağlayın", p, total, audience="MÜŞTERİ")
    image_contain(c, IMAGES / "m-dokuman.png", 34, 96, 520, 389, caption="Müşteri belge/not görünümü · örnek veriler")
    numbered_step(c, 1, "Dosyayı aç veya indir", "Kartın Dokümanlar bölümünde İndir düğmesini kullan.", 575, 482, 232, h=60)
    numbered_step(c, 2, "Notlar’ı aç", "Desteklenen PDF ve görsellerde işaret bırakabilirsiniz.", 575, 410, 232, h=60)
    numbered_step(c, 3, "Değişiklik yerini işaretle", "Noktayı seçip açık ve ölçülebilir bir açıklama yazın.", 575, 338, 232, h=60)
    callout(c, "Revizyon kararı ayrıca gerekir", "Belge üzerine not koymak tek başına revizyon kararı değildir. Onay adımına dönüp <b>Revizyon İstiyorum</b> düğmesine de basın.", 575, 214, 232, 97, "warn")
    callout(c, "Dosya açılmıyorsa", "Açılır pencereye izin verin ve yeniden deneyin. İndirme bağlantısı güvenlik nedeniyle süreli üretilir.", 575, 96, 232, 97, "info")


def customer_page_tracking(c, p, total):
    page_base(c, "Takip ve Rapor", "İşin hangi aşamada olduğunu görmek", "Filtreleri kullanarak yalnızca ilgili çalışmaları inceleyin", p, total, audience="MÜŞTERİ")
    image_contain(c, IMAGES / "m-rapor.png", 34, 100, 500, 385, caption="Müşteri raporu · örnek veriler")
    mini_card(c, "İş Akışı", "Kart içindeki adımlar işin güncel yerini gösterir. Ekip içi personel ve süre ayrıntıları gösterilmez.", 556, 384, 251, 101, accent=BLUE, tag="KART")
    mini_card(c, "Rapor", "Tarih ve marka kapsamına göre toplam kart, durum ve bekleyen onayları izleyin.", 556, 263, 251, 101, accent=PURPLE, tag="ÖZET")
    callout(c, "Bekleyen onaylar", "Bir kartta onayınız gerekiyorsa kartı açın; turuncu uyarıyı ve Dokümanlar bölümündeki dosyaları kontrol edin.", 556, 174, 251, 70, "warn")
    callout(c, "Güncel görünmüyorsa", "Sayfayı yenileyin. Karar gönderirken hata aldıysanız aynı düğmeye tekrar tekrar basmayın.", 556, 100, 251, 58, "info")


def customer_page_faq(c, p, total):
    page_base(c, "Yardım", "Sık karşılaşılan durumlar", "Kart ve adım adı destek süresini kısaltır", p, total, audience="MÜŞTERİ")
    items = [
        ("Onay düğmeleri yok", "Adım henüz size gelmemiş veya karar zaten verilmiş olabilir. Karttaki açıklamayı okuyun; gerekirse ekibe sorun.", "info"),
        ("Yanlış dosya gördüm", "Karar vermeyin. Kart adını ve gördüğünüz dosya adını ekibe bildirin; ekip dosyaları düzeltip haber verir.", "warn"),
        ("Revizyon notu kabul edilmiyor", "Revizyon isterken görüş alanı zorunludur. Değişiklik yerini ve beklenen sonucu yazın.", "danger"),
        ("Onayı yanlış verdim", "Kaydedilmiş karar panelden geri alınmaz. Kart adıyla hemen ekibe ulaşın.", "danger"),
        ("Dosya açılmıyor", "Tarayıcı açılır pencere iznini kontrol edin; sayfayı yenileyip İndir düğmesini tekrar kullanın.", "info"),
        ("Kart görünmüyor", "Hesabınıza doğru markanın tanımlandığını ekibe kontrol ettirin.", "warn"),
    ]
    positions = [(34, 339), (421, 339), (34, 213), (421, 213), (34, 87), (421, 87)]
    for item, pos in zip(items, positions):
        callout(c, item[0], item[1], pos[0], pos[1], 368, 106, item[2])


def build_customer(path: Path):
    total = 7
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("Lokasyon Operasyon Paneli - Müşteri Kullanım Kılavuzu")
    c.setAuthor("Lokasyon İstanbul")
    draw_cover(c, "MÜŞTERİ\nKULLANIM KILAVUZU", "Kartı bulun, size sunulan dosyaları açın ve kararınızı güvenle kaydedin.", "Marka müşterileri için hazırlanmıştır.", "9bc6f3e66826", ORANGE, total, customer=True)
    c.showPage()
    customer_page_nav(c, 2, total); c.showPage()
    customer_page_find(c, 3, total); c.showPage()
    customer_page_decision(c, 4, total); c.showPage()
    customer_page_comments(c, 5, total); c.showPage()
    customer_page_tracking(c, 6, total); c.showPage()
    customer_page_faq(c, 7, total); c.showPage()
    c.save()


def main():
    general = OUT / "Lokasyon-Operasyon-Paneli-Genel-Kullanim-Kilavuzu.pdf"
    customer = OUT / "Lokasyon-Operasyon-Paneli-Musteri-Kilavuzu.pdf"
    build_general(general)
    build_customer(customer)
    print(general)
    print(customer)


if __name__ == "__main__":
    main()
