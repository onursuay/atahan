# 🚀 Demolition Mech 3D - Patlamalı Yıkım Oyunu

Web tarayıcısında çalışan, Three.js ve Cannon-es fizik motoruyla güçlendirilmiş, gerçek zamanlı 3D patlamalı bina yıkım oyunu!

---

## 🎮 Oyun Özellikleri

- **3D Karakter (Yıkım Robotu / Demolition Mech):**
  - İki bacaklı, omuzunda devasa roketatar taşıyan, zırhlı ve animasyonlu 3D robot.
  - **W tuşu:** Karakteri ileri doğru yürütür.
  - **A, S, D tuşları:** Sola, geriye ve sağa hareket.
  - **Boşluk (Space):** İtici roketlerle yukarı zıplama.
  - **Fare / Sol Tık:** Kamerayı serbestçe döndürme ve hedef bloklara patlayıcı fırlatma.
- **Gerçek Zamanlı 3D Fizik & Yıkım:**
  - Cannon-es fizik kütüphanesiyle simüle edilen yüzlerce yıkılabilir yapı bloğu.
  - Vurulan kolonlar devrilir, tavanlar çöker, parçalar çevreye savrulur.
- **Zincirleme TNT Patlamaları:**
  - Kırmızı TNT blokları vurulduğunda gecikmeli devasa şok dalgaları yaratarak çevresindeki blokları havaya fırlatır.
- **3 Farklı Silah Türü:**
  - 🚀 **Roket:** Yüksek hız, doğrudan isabet anında patlama ve güçlü itme dalgası.
  - 💣 **Bomba:** Seken, zeminde yuvarlanan ve yüksek alan hasarı veren zaman ayarlı patlayıcı.
  - 💥 **Nükleer Darbe:** Devasa etki yarıçapı ve tüm yapıyı yerle bir eden süper güç.
- **5 Farklı Mimari Bölüm:**
  - Bölüm 1: Eğitim Kulesi (Temel kule yıkımı)
  - Bölüm 2: İkiz Kuleler ve Asma Köprü (Bağlantı çökmeleri)
  - Bölüm 3: TNT Fabrikası (Zincirleme reaksiyon şöleni)
  - Bölüm 4: Dev Gökdelen (Kat kat çökertme)
  - Bölüm 5: Mega Şato ve Surlar (Büyük kale kuşatması)
- **Prosedürel Web Audio API:**
  - Harici ses dosyası indirmeye gerek olmadan anında çalışan patlama, adım, roket ve zafer ses efektleri.

---

## 🛠️ Yerel Olarak Çalıştırma

Projeyi bilgisayarınızda yerel olarak çalıştırmak için:

```bash
# Bağımlılıkları yükleyin (zaten yüklü ise gerekmez)
npm install

# Geliştirici sunucusunu başlatın
npm run dev
```

Terminalde beliren adrese (örneğin `http://localhost:5173`) tarayıcınızdan girip hemen oynayabilirsiniz.

---

## 📦 Projeyi GitHub'a Yükleme ve Vercel ile Yayınlama Adımları

### 1. Adım: GitHub Reposu Oluşturma
1. [GitHub](https://github.com) hesabınıza giriş yapın.
2. Sağ üstteki **+** ikonuna tıklayıp **New repository** seçeneğini seçin.
3. Repoya bir isim verin (Örn: `demolition-mech-3d`).
4. **Public** seçin ve hiçbir kutucuğu (README, .gitignore vb.) işaretlemeden **Create repository** butonuna basın.

### 2. Adım: Dosyaları GitHub'a Gönderme
Terminalde proje klasöründeyken şu komutları sırasıyla çalıştırın:

```bash
git add .
git commit -m "feat: 3D Demolition Mech Game initial release"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/REPOSİTORY_ADINIZ.git
git push -u origin main
```
*(Yukarıdaki URL'yi kendi GitHub repo adresinizle değiştirin.)*

### 3. Adım: Vercel Üzerinde Yayına Alma
1. [Vercel](https://vercel.com) hesabınıza giriş yapın (GitHub ile giriş yapmanız önerilir).
2. **Add New...** > **Project** butonuna tıklayın.
3. GitHub'a yeni yüklediğiniz `demolition-mech-3d` reposunu seçin ve **Import** butonuna basın.
4. Vercel projeyi otomatik olarak **Vite** olarak algılayacaktır:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. **Deploy** butonuna tıklayın!
6. Yaklaşık 20-30 saniye içinde oyununuz tüm dünyaya açık canlı bir bağlantı (örn: `https://demolition-mech-3d.vercel.app`) ile yayına girecektir.

---

İyi eğlenceler ve bol patlamalı yıkımlar! 💥
