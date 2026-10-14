# 💥 Teardown 3D — Voxel Şehirde Yıkım ve Keşif Oyunu

Tarayıcıda çalışan, Three.js ve Cannon-es ile yapılmış, **küplerden (voxel) oluşan iki adalı bir şehirde** geçen yıkım ve keşif oyunu. Binalar yıkılabilir, parçalar fizikle dağılır, bağlantısı kopan üst katlar çöker. Şehirde yürüyen insanlar, trafikte giden arabalar ve gökte uçan uçaklar var.

---

## 🎮 Kontroller

| Tuş / Fare | İşlev |
|---|---|
| **W A S D** | Yürü (arabadayken: gaz, fren/geri, direksiyon) |
| **Fare** | Etrafa bak |
| **Sol tık** | Ateş et / kılıç savur / bomba yerleştir |
| **Sağ tık** | Işın kılıcı elindeyken: kılıcı tam tur döndür (art arda basılabilir, en fazla bir dönüş sıraya girer) |
| **Boşluk** | Zıpla. Havadayken **basılı tut: jetpack** (arabadayken el freni) |
| **Tab** | Silah menüsü (imleç serbest kalır, silahı tıklayarak seç) |
| **E** | Yakındaki arabaya bin / araçtan in. Araç yoksa çekiç vurur |
| **X** | Sniper nişangâhı (yalnız sniper elindeyken) |
| **F** | Yerleştirilmiş uzaktan bombaları patlat |
| **R** | Şarjör değiştir (tabanca, pompalı, AK-47, sniper) |
| **V** | Kamera: karakterin gözünden ↔ uzaktan |

Oyun varsayılan olarak **birinci şahıs** bakışla açılır. Karakterin gövdesi gizlenir, yalnızca kollar ve elindeki silah görünür.

---

## 🔫 Silahlar (Tab menüsünden seçilir)

- **Delici Roket** — duvarda delik açar, patlamada çevredeki her şeyi etkiler.
- **Minigun** — basılı tutunca namlular döner, saniyede yaklaşık 18 mermi atar.
- **Işın Kılıcı** — tutacağın iki ucundan birer bıçak çıkan **çift taraflı** kılıç. **Sol tık** fare hareketine göre yatay, dikey ve çapraz savurur. **Sağ tık** kılıcı elin etrafında 4 tam tur döndürür (~1.5 sn): yön her seferinde (öncekinden farklı) sağ, sol, yukarı ya da aşağı olur ve hafifçe sapar. Dönerken iki bıçağın gerçek konumları taranır; temas ettiği binalar yalnızca bıçağın geçtiği şeritte kesilir ve kopan parçalar bıçağın hareket yönünde savrulup fizikle düşer. Kameraya 1.2 m'den yakın noktalar kesilmez.
- **Tabanca**, **Pompalı** (9 saçma), **AK-47** (otomatik), **Sniper** (güçlü ve uzun menzilli).
  Bu dört silahın şarjörü vardır: tabanca 12, pompalı 6, AK-47 30, sniper 5 mermi. Şarjör boşalınca otomatik değişir, **R** ile elle de değiştirilir (değişirken ateş edilemez). Kalan mermi sağ altta görünür; silah değişince yarım kalan değişim iptal olur.
- **Süreli Bomba** — yerleştirince 3 saniye geri sayar, bip sesi giderek sıklaşır.
- **Uzaktan Bomba** — yerleştirince bekler; ekrandaki **PATLAT** butonu ya da **F** ile patlar.
- **Çekiç** (E) — yakın mesafede küçük hasar verir; demir kırılmaz.

---

## 🔊 Sesler

Tüm sesler Web Audio ile kodla üretilir (ses dosyası yoktur). Sağ üstteki 🔊 düğmesi hepsini kapatır.

- **Silahlar:** tabanca, pompalı, AK-47, sniper ve minigunun ateş sesleri birbirinden farklıdır; pompalıda her atıştan sonra sürgü sesi gelir.
- **Minigun:** namlular dönmeye başlayınca yükselen mekanik motor vızıltısı; atışlar sürekli ve güçlü bir "brrrt" olarak duyulur. Bırakınca motor yavaşça susar.
- **Bazuka (roket):** fırlatırken gürleyen itki ve uzaklaşan tıslama; çarpınca keskin çatlama ve uzayan gürlemeli patlama.
- **Işın kılıcı:** açılırken yükselen enerji vızıltısı, elde tutarken iki bıçağın vuruntulu sürekli vızıltısı (harekete göre perdesi yükselir), savurma ve dönüşte "vııın", bir şeyi keserken kıvılcım cızırtısı. Sürekli sesler tek örneklidir; silah değişince ya da arabaya binince kapanır.
- **Şarjör:** şarjör mandalı, düşen şarjör, yeni şarjörün oturması ve sürgü sesi (pompalıda kovanların tek tek sürülmesi).
- **Araba:** sürdüğün arabada hıza göre yükselen motor sesi, gazda egzoz gürlemesi, tekerlek/yol gürültüsü ve frende lastik cızırtısı. Trafikteki arabalar sessizdir.
- **Su:** yüzerken sürekli şapırtı; hareket ettikçe güçlenir. Suya girişte ayrıca sıçrama sesi gelir.
- Yürürken ayak sesi **yoktur**.
- Hazır ses dosyası kullanılmaz; tüm sesler kodla sentezlendiği için telif/lisans konusu yoktur.

---

## 🏙️ Dünya

- **İki ada** ve aralarında **kırmızı asma köprü** (basamaklı kuleler, kablolar, askılar).
- **Batı ada:** şehir merkezi, kumsal ve iskeleler, büyük park (çeşme, gölet, çardak, çocuk parkı), market, çarşı, banka, kafe, depo, konut sitesi (çitli, kapılı), apartmanlar ve ofisler.
- **Doğu ada:** hastane (beyaz, girişte kırmızı artı), itfaiye, polis merkezi, okul, AVM, otel ve apartman blokları; ortada **otoyol** (her yönde 3 şerit), üstünden geçen **üst geçit** (9.75 m geniş; iki yanındaki rampalar basamaksız, doğrusal eğimlidir, en dik yeri ≈13°; araçlar eğime göre burnunu kaldırır) ve otoyola bağlanan sağa dönüş rampaları; doğuda zengin bölge.
- Yollar iki yönlüdür (her yönde bir şerit). Sokak lambaları, çöp kutuları ve ağaçlar sokak donatımıdır.
- Binaların içine girilir; içlerinde merdiven ve mobilya (mutfak, yatak odası, salon, banyo, otel odaları, ofis masaları) vardır.

### 🌍 Zemin: iki katman
- **Üst katman** (yol, kumsal, çim): patlama ve çekiçle kırılır, parçaları dağılır, kenarları pürüzlü bir çukur kalır. Yürümek ya da zıplamak kırmaz.
- **Alt katman** (taban kayası): hiçbir şeyle kırılamaz. Üst katman kırılınca yükselip boşluğu kapatmaz; çukurun tabanı olarak kalır ve üzerinde yürünür.

### 🧱 Yıkım
- Her yapı küplerden oluşur; küpler **0,5 m**'dir ve yüzlerine 2×2 ince ızgara dokusu işlenmiştir. Yıkımdaki döküntü parçaları yarım boyutludur.
- **Yapısal çökme:** zemine bağlı olmayan kısım (ör. ortasından patlatılan binanın üstü) aşağı düşer, yere çarpınca oturur ya da kırılıp dağılır.
- Zincirleme TNT patlamaları, delik açma, havaya saçılan fizikli döküntüler.

---

## 🧍 Canlılar ve araçlar

- **NPC insanlar:** rastgele dolaşır, deniz/duvar/çukur kenarında sağa ya da sola döner. Silahlarla, patlamayla ve çekiçle vurulabilir (küplere dağılırlar), bir süre sonra yenisi doğar.
- **NPC arabalar (9 tür):** spor, mini, sedan, SUV, pickup, minibüs, kamyon, polis (çakarlı) ve ambulans (haçlı, çakarlı); boyut, hız ve ağırlıkları farklıdır. Yolda sağ şeritten gider, kavşakta yuvarlak yaylarla döner, otoyola sağdan katılır ve sağdan çıkar. Önüne biri çıkarsa ya da başka araç girerse durur. Her araç ön, arka, sol ve sağ olmak üzere **dört bölgeden** oluşur:
  - Bir bölgeye vurulunca yalnızca o bölge parçalanır: paneller kopar ve **orta boy parçalar** (0.3–0.75 m, panelin boyutuna göre) halinde savrulur. Diğer bölgeler etkilenmez, çatlak efekti yoktur. Zaten parçalanmış bölgeye tekrar vurmak hiçbir şeyi değiştirmez.
  - Ön bölge parçalanınca motor ölür: trafikteki araç durur ve dumanlanır; sürdüğün araç ise yarı hızla gider ve duman çıkarır.
  - Parçalanan bölgenin altındaki **demir iskelet** yalnızca **pompalı, sniper, roket (ve bomba/TNT patlamaları) ve ışın kılıcı** ile kırılır. Tabanca, AK-47 ve minigun demire işlemez. Demiri iki bölgede kırılan araç yanıp patlar. Yakın patlama paneli ve demiri birlikte kırar, uzak patlama yalnız panelleri koparır.
  - Araç-araç çarpışmasında çarpışma yönündeki bölge hasar alır (hafif araç ağırdan daha çok hasar alır); demir kırılmaz.
- **Arabaya binip sürebilirsiniz** (E, W A S D). Hızlı çarpışma binayı kırar, yayaları ezer.
- **Uçaklar:** Boeing 737 görünümlü yolcu uçakları ara sıra geçer. Roket ya da minigunla vurulursa dumanlı düşer, yere çarpınca geniş çukur ve yıkım bırakır.

---

## ❤️ Can, jetpack ve fizik

- **Can:** patlamaya yakınken hasar alırsınız (merkezde ağır, uzakta hafif). Can 0 olunca spawn noktasında yeniden doğarsınız; yıkım ve puan korunur. Hasardan 5 saniye sonra can yavaşça yenilenir.
- **Jetpack:** havadayken Boşluk'u basılı tutun. Yakıt yaklaşık 7 saniye yeter, yerde dolar. Tuşu bırakınca hava direnci yavaşlatır ve düşersiniz.
- **Su:** denizde yüzülür; kıyıya Boşluk ile tırmanılır. Dalgalar, sıçrama, suya düşen parçaların yüzmesi vardır.
- Patlama dalgası oyuncuyu savurur.
- **Araba sürerken momentum:** yeterince hızlı (aracın azami hızının yaklaşık %40'ından fazla) bir araç duvara çarpınca hemen durmaz. Kesilen her küp enerji harcar; araç biraz yavaşlayıp duvarı **delip geçmeye devam eder**. Ağır araçlar (kamyon, ambulans, minibüs) daha az yavaşlar. Daha yavaşsa ya da duvar demirse araç durur ve geri sekir. Çarpan uç (ön, geri giderken arka) hasar alır.

---

## 🛠️ Yerel Olarak Çalıştırma

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # üretim derlemesi (dist/)
```

Dünyanın boyutu ve küp sayısı büyük olduğundan (yaklaşık 350.000–450.000 küp) güçlü bir ekran kartı önerilir. Küp boyutu `src/config.js` içindeki `VOXEL_SIZE` ile ayarlanır (küçültmek küp sayısını hızla artırır).

---

## 📁 Kod yapısı

| Dosya | Görev |
|---|---|
| `src/main.js` | Oyun döngüsü, kamera, girişler, can, araca binme |
| `src/teardown.js` | Voxel dünyası, yıkım, döküntü, çökme bağlantısı |
| `src/collapse.js` | Yapısal çökme (zemine bağlı olmayan parçalar düşer) |
| `src/terrain.js` | İki katmanlı zemin, tepeler, kırılan çukurlar |
| `src/levels.js` | Dünya düzeni: adalar, yollar, köprü, binalar, park |
| `src/character.js` | Karakter hareketi, voxel çarpışması, yüzme, jetpack |
| `src/handweapons.js`, `src/weapons.js` | Silahlar, şarjör sistemi ve elde görünen modeller |
| `src/audio.js` | Prosedürel ses motoru: silah, şarjör, motor, su ve diğer efektler |
| `src/bombs.js` | Süreli ve uzaktan bombalar |
| `src/npc.js`, `src/cars.js`, `src/planes.js` | İnsanlar, arabalar (trafik, sürüş, bölgesel hasar, momentum), uçaklar |
| `src/carmodels.js` | 9 araç tipinin modelleri, bölgeler ve demir iskelet |

---

## 🚀 Yayınlama

Depo: https://github.com/onursuay/atahan — `main` dalına push edilince Vercel yeniden derler (`vercel.json`: `npm run build`, çıktı `dist/`).
