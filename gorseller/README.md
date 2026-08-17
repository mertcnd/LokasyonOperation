# Logo kaynakları

`index.html` içinde bu iki PNG base64 olarak gömülüdür (`--logo` değişkeni).
Panelin tek dosyalık yapısı korunsun diye gömülü tutuluyorlar; burada duran
kopyalar kaynak dosyalardır.

- `logo-gunduz.png` — lacivert logo, açık zeminler için (`:root`)
- `logo-gece.png`   — beyaz logo, koyu zeminler için (`[data-tema="gece"]`)

İkisi de 614×390, RGBA, şeffaf zeminli.

Logo değişirse: dosyayı burada güncelleyin, base64'e çevirip index.html'deki
ilgili `--logo:url(data:image/png;base64,...)` değerini değiştirin.
