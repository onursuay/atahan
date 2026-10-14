# 💥 Teardown 3D — Voxel Şehirde Yıkım ve Keşif Oyunu

Tarayıcıda çalışan, Three.js ve Cannon-es ile yapılmış, **küplerden (voxel) oluşan iki adalı bir şehirde** geçen yıkım ve keşif oyunu. Binalar yıkılabilir, parçalar fizikle dağılır, bağlantısı kopan üst katlar çöker. Şehirde yürüyen insanlar, trafikte giden arabalar ve gökte uçan uçaklar var.

---

## 🎮 Kontroller

| Tuş / Fare | İşlev |
|---|---|
| **W A S D** | Yürü (arabadayken: gaz, fren/geri, direksiyon) |
| **Fare** | Etrafa bak |
| **Sol tık** | Ateş et / ışın kılıcını döndür / bomba yerleştir |
| **Sağ tık (basılı tut) + fare sürükleme** | Kapıya bakınca ekrandaki küçük **+** nişangâh küçük bir **ele** döner; sağ tuşu basılı tutup fareyi sürükleyince kapı açılır/kapanır (el yumruğa döner). Tek tıklama bir şey yapmaz; kapı tutulurken ateş edilmez |
| **Boşluk** | Zıpla. Havadayken **basılı tut: jetpack** (arabadayken el freni) |
| **Tab** | Silah menüsü (imleç serbest kalır, silahı tıklayarak seç) |
| **E** | Yakındaki arabaya bin / araçtan in. Araç yoksa çekiç vurur |
| **X** | Sniper nişangâhı (yalnız sniper elindeyken) |
| **Z** | Testere diskinin yönü: yatay ↔ dikey (yalnız testere elindeyken) |
| **F** | Yerleştirilmiş uzaktan bombaları patlat |
| **R** | Şarjör değiştir (tabanca, pompalı, AK-47, sniper) |
| **V** | Kamera: karakterin gözünden ↔ uzaktan |

Oyun varsayılan olarak **birinci şahıs** bakışla açılır. Karakterin gövdesi gizlenir, yalnızca kollar ve elindeki silah görünür.

---

## 🔫 Silahlar (Tab menüsünden seçilir)

- **Delici Roket** — duvarda delik açar, patlamada çevredeki her şeyi etkiler.
- **Minigun** — basılı tutunca namlular döner, saniyede yaklaşık 18 mermi atar.
- **Çift Minigun** — minigunun aynısı, iki elde birden: iki silah da aynı sesle, aynı hızda (her biri saniyede ~18 mermi) ve aynı hasarla ateş eder; toplam 36 mermi/sn.
- **Işın Kılıcı** — tutacağın iki ucundan birer bıçak çıkan **çift taraflı** kılıç. **Sol tık (tek tıklama)** kılıcı ~2.5 sn boyunca sürekli döndürür: sağ-sol, yukarı-aşağı ve ileri doğru dönüşler birleşiktir, kılıç her yöne takla atar (her eksende birkaç tam tur; bitince tam yerine oturur). Dönüş sürerken gelen tıklamalardan yalnızca biri sıraya girer. Dönerken iki bıçağın gerçek konumları taranır; temas ettiği binalar yalnızca bıçağın geçtiği şeritte kesilir ve kopan parçalar bıçağın hareket yönünde savrulup fizikle düşer. Kameraya 1.2 m'den yakın noktalar kesilmez. Kılıç arabaya da değer (demir iskeleti de keser).
- **Tabanca**, **Pompalı** (9 saçma), **AK-47** (otomatik), **Sniper** (güçlü ve uzun menzilli).
  Bu dört silahın şarjörü vardır: tabanca 12, pompalı 6, AK-47 30, sniper 5 mermi. Şarjör boşalınca otomatik değişir, **R** ile elle de değiştirilir (değişirken ateş edilemez). Kalan mermi sağ altta görünür; silah değişince yarım kalan değişim iptal olur.
- **Süreli Bomba** — yerleştirince 3 saniye geri sayar, bip sesi giderek sıklaşır.
- **Uzaktan Bomba** — yerleştirince bekler; ekrandaki **PATLAT** butonu ya da **F** ile patlar.
- **Çekiç** (E) — yakın mesafede küçük hasar verir; demir kırılmaz.

### 🧪 Cephanelik: 6 özel silah (Tab menüsünün sonunda; `src/arsenal.js`)
Tabanca benzeri değiller; her biri dünyayı kendine özgü biçimde yıkar. Hepsi mevcut yıkım sistemini (voxel kesme, zemin kırma, çökme/devrilme) ve araç, kapı, insan, uçak, köprü ipi hasarını kullanır. Mermi sınırı yoktur, her birinin kendi bekleme süresi vardır. Silah seçince alt ortada kısa bir kullanım ipucu çıkar.
- **🕳️ Kara Delik Topu** — tıkla: yavaş karanlık bir küre fırlar; bir şeye çarpınca (ya da 3 sn sonra) **3.6 sn'lik kütleçekim kuyusu** açar: 11 m çevredeki yapıdan küpleri söker ve merkeze fırlatır, havadaki döküntüyü çeker, insanları emer, zemini yer yer kırar. Sonunda kuyu çöker (içe patlama). Bekleme 4.2 sn.
- **⚡ Yıldırım Bobini** — sol tık basılı tut: saniyede ~12 zikzaklı yıldırım. Çarptığı yeri (demir dahil) eritip içeri doğru oyar; **iletken şeylere zincirleme sıçrar** (demir küp, araç, insan; 4 sıçrama, yakında iletken yoksa kısa dallanır). Köprü ipini de keser.
- **🔥 Eritici** — tıkla: yapışan akkor çamur fırlar; çarptığı yerde 6.5 sn boyunca büyüyerek (2.8 m'ye kadar) ve aşağı süzülerek yapıyı eritir, lav damlaları saçar; araç, kapı ve insana da işler. Aynı anda en çok 6 çamur. Bekleme 1 sn.
- **🌋 Yer Sarsıcı** — tıkla: baktığın yerden **30 m'ye kadar genişleyen şok dalgası**. Zeminin üst katını çatlatır, dalganın geçtiği binaların diplerini ezer (iki yükseklikte kesilir; bu, bina çökmesini/devrilmesini tetikler), insanları ve araçları vurur. Bekleme 3.4 sn.
- **⚫ Yıkım Topu** — tıkla: ağır demir gülle fırlar; hızına göre **3.5 m'lik tünel** açarak içinden geçer (çarpınca çevreye ek şok dalgası), yere vurunca zıplayıp zemini kırar; 3 sekmeden sonra durur. Bekleme 1.7 sn.
- **🌀 Testere Diski** — tıkla: büyük dişli **bumerang disk** fırlar, 52 m gider, kesip geri döner ve elinde yakalanır (bu sırada ikinci disk atılamaz). **Z** ile yön seçilir: **yatay** (bir kat hizasından şerit keser; binanın cephesine paralel atarsan cepheyi dilimler) ya da **dikey** (4.4 m'lik dilim keser). Kestikçe yavaşlar, demir daha çok yavaşlatır.

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
- **Yol ağı tek kaynaktan** (`src/cityplan.js`): asfalt boyama, trafik ağı ve yol/bina çakışma denetimi aynı tanımı kullanır. **Hiçbir yol çıkmaz uçta bitmez**: her yolun iki ucu başka bir yola ya da göbeğe bağlanır; hiçbir bina, lamba, çöp kutusu, ağaç ya da çardak yolun üstüne girmez (testle doğrulanır). Trafik ağı güçlü bağlantılıdır (her noktadan her noktaya gidilebilir) ve birbirini bekleyen araçlar 15 sn sonra yeniden doğar.
- **Batı ada (şehir):** eskisinin yaklaşık 2.5 katı. Kıyı bulvarı, 4 kuzey-güney sokak ve 8 doğu-batı cadde (ana cadde köprüye uzanır); şehir merkezi, kumsal ve iskeleler, büyük park (çeşme, gölet, çardak, çocuk parkı), market, çarşı, banka, kafe, depo, konut sitesi (iç yolu iki caddeyi birleştirir, kapıları açık), apartmanlar ve ofisler; kuzey ve güneyde yeni mahalleler.
- **Göbek:** kuzey mahallesinin ortasında bir **yuvarlak kavşak**: halka yol (saat yönünün tersine tek yönlü; araçlar halkaya girer, döner ve çıkar), ortada çim ada, çeşme, dikilitaş ve ağaçlar; dört yol halkaya açılır. Çevresinde bina yoktur.
- **Kapılar:** bina girişleri gerçek, normal boyda (≈1-1.5 m × 2.5 m) menteşeli kapılardır; açıklığın artanı duvarla doludur. Menteşeli kapının açısı ve eylemsizliği vardır; kapalıyken oyuncuyu ve yayaları engeller. Açmak için kapıya bakıp (nişangâh ele döner) **sağ tuşu basılı tutarak fareyi sürükleyin** (sağa/yukarı = it, sola/aşağı = çek; bırakınca kapı biraz daha gidip durur). Kapılar **kırılabilir**: mermi, roket/patlama, çekiç (E), ışın kılıcı ve yeterince hızlı araç kapıyı orta boy parçalara ayırır. **Geniş girişler (AVM, hastane, itfaiye garajı) iki kanatlı sürgülü otomatik kapıdır** (≈4 m × 3 m): oyuncu, yaya ya da araç yaklaşınca yanlara kayarak açılır, uzaklaşınca kapanır.
- **Bina içleri:** her binanın içi döşelidir (94 binanın tamamında zemin kat dolu): mutfak (tezgâh, evye, ocak, buzdolabı, yemek masası), salon (kanepe, sehpa, TV), yatak odası, banyo; ofislerde masa ve monitörler, dükkânlarda tezgâh ve raflar, otellerde resepsiyon ve odalar, okul/karakol/hastane/itfaiye/AVM için özel iç mekânlar. Alçak binalar dükkân, orta boylular müstakil ev, yüksekler ofis/apartman olarak döşenir; kapı önleri ve merdivenler boş bırakılır; kapı önüne lamba, ağaç ya da çöp kutusu konmaz.
- **Işıklandırma:** sokak lambaları ve bina/AVM içlerinin tavanındaki lambalar kendi ışığıyla parlayan **Lamba (Işık)** malzemesidir (Altın'dan ayrı bir malzemedir); katlı her binanın her katında ve AVM'nin her katında tavan lambaları vardır.
- **AVM:** eski AVM'nin yaklaşık 3 katı hacimde (4 kat; kat yüksekliği 6 m, çok katlı balkonlar ve ortada atrium). İç mağazalar şimdilik yapılmadı.
- **Asma köprü** (`src/bridge.js`): ana kablolar kırmızı **küplerdir** (yıkılabilir, basamaklı/pürüzlü eğri); tabliyeyi tutan dikey **ipler** ince silindirdir (voxel en az 0.5 m olurdu). İp mermi, patlama, kılıç, yıldırım gibi şeylerle vurulunca **gerçek ip gibi kopar**: iki parça halinde sarkıp savrulur. Bir ip koptuğunda **köprü sönümlü biçimde hafifçe sallanır** (yalnız görsel; çarpışma sabit kalır). Tabliye kule, kıyı ve sağlam iplerce taşınır (en çok 6 m uzakta asılı kalır); çok sayıda ip kopar ya da tabliye bir noktadan kırılırsa desteksiz kalan kısım kuleden **menteşelenip sarkar, kopar, suya düşer, yavaşça batar ve yok olur**.
- **Doğu ada:** hastane (beyaz, girişte kırmızı artı), itfaiye, polis merkezi, okul, AVM, otel ve apartman blokları; batı ve doğu kıyı yolları, ortada **otoyol** (her yönde 3 şerit), üstünden geçen **üst geçit** (9.75 m geniş; iki yanındaki rampalar basamaksız, doğrusal eğimlidir, en dik yeri ≈13°; araçlar eğime göre burnunu kaldırır) ve otoyola bağlanan sağa dönüş rampaları; doğuda zengin bölge.
- **Villa tepesi (köprüden sonra, doğu adanın doğusu):** zengin meydanının doğusunda, **üstü dümdüz** (12 m yükseklikte, yaklaşık 60 × 68 m) yumuşak etekli bir tepe. Sivri tepe yoktur; etek kademeli iner. Meydandan doğuya **düz gidip sola yumuşak bir kavis yapan** (≈105 m, en dik yeri ≈7°) bir yol tepeye çıkar; üst geçit rampası gibi basamaksızdır ve uçları zemine/platoya pürüzsüzce bağlanır. Yol **trafik ağında değildir: araçlar oraya gitmez**. Yol kenarında lambalar, platoda ağaçlar vardır. Tepede **beyaz, kahverengi (ahşap), siyah ve camdan modern bir villa** durur (`src/villa.js`): zemin kat beyaz kutu + cam cephe, üst kat siyah ve doğuya 10 m taşan konsol; güney balkon ve batı çatı terası (cam korkuluk); parlayan mavi **havuz**, şezlonglar, renkli bahçe lambaları; konsol altında ateş çukurlu açık salon. İçeride: salonda üç **ekranlı (Stark tarzı HUD) TV duvarı**, bar (renkli şişeler), mutfak adası, yemek masası ve avize, neon pembe merdiven; üst katta yatak odası, cam banyo, **laboratuvar** (dört ekran, holo masa, vitrinde kırmızı-altın zırh) ve panoramik salon. Renkli LED şeritler ve parlayan küpler (mavi, pembe, mor, yeşil, turuncu ışık malzemeleri) ile aydınlatılmıştır. Villada **tek bir çok zengin adam** yaşar (siyah takım, gümüş saç, gözlük, altın saat): yalnızca villa ve terasında dolaşır, vurulursa 1000 puan verir ve bir dakika sonra yeniden belirir.
- Yollar iki yönlüdür (her yönde bir şerit). Sokak lambaları, çöp kutuları ve ağaçlar sokak donatımıdır.
- Binaların içine girilir; içlerinde merdiven ve mobilya (mutfak, yatak odası, salon, banyo, otel odaları, ofis masaları) vardır.

### 🌍 Zemin: iki katman
- **Üst katman** (yol, kumsal, çim): patlama ve çekiçle kırılır, parçaları dağılır, kenarları pürüzlü bir çukur kalır. Yürümek ya da zıplamak kırmaz.
- **Alt katman** (taban kayası): hiçbir şeyle kırılamaz. Üst katman kırılınca yükselip boşluğu kapatmaz; çukurun tabanı olarak kalır ve üzerinde yürünür.

### 🧱 Yıkım
- Her yapı küplerden oluşur; küpler **0,5 m**'dir ve yüzlerine 2×2 ince ızgara dokusu işlenmiştir. Yıkımdaki döküntü parçaları yarım boyutludur.
- **Yapısal çökme** (`src/collapse.js`):
  - Zemine bağlı olmayan kısım (ör. ortasından kesilen binanın üstü) önce **gıcırdar ve kenarlarından döküntü saçar** (büyükse), sonra düşer.
  - **Düz iniş:** hasar yalnız yere temas eden alt katmanlarda yoğunlaşır ve yukarı doğru hızla azalır; üstteki katlar sağlam kalır. Hız ne kadar fazlaysa o kadar çok küp kırılır. (Testte 20 m'lik kulenin ortası kesildiğinde üst yarının %99-100'ü sağlam kaldı.)
  - **Yokuş / kısmi destek / eğik düşüş:** parçanın yere ilk değen noktaları ağırlık merkezini taşımıyorsa parça o kenar etrafında **yavaş yavaş devrilir** (üstel hızlanır), çarptığında eğik olduğu için hıza ve açıya göre **iyice parçalanır**.
  - **Zemine bağlı ama tabanı yıkılmış yapı:** kalan taban ağırlık merkezini taşımıyorsa (alt katın büyük kısmı yıkılmış bina) yapı yavaşça devrilir. Hasarsız şehirde 791 yapının hiçbiri kendiliğinden devrilmez (testle doğrulandı).
  - **Suya düşen parça** yavaşça batar (0.7 m/sn), yeterince alçalınca yok olur. Su sıçrar.
  - Dünyada çok az yokuş vardır (villa tepesi, rampalar); yokuşta durmakta olan binanın kaymasını ayrıca simüle etmez: yokuş etkisi düşen parçanın yamuk inmesi ve devrilen yapının tabanı üzerinden çalışır.
- Zincirleme TNT patlamaları, delik açma, havaya saçılan fizikli döküntüler.

---

## 🧍 Canlılar ve araçlar

- **NPC insanlar:** rastgele dolaşır, deniz/duvar/çukur kenarında sağa ya da sola döner. Silahlarla, patlamayla ve çekiçle vurulabilir (küplere dağılırlar), bir süre sonra yenisi doğar.
- **NPC arabalar (9 tür):** spor, mini, sedan, SUV, pickup, minibüs, kamyon, polis (çakarlı) ve ambulans (haçlı, çakarlı); boyut, hız ve ağırlıkları farklıdır. Yolda sağ şeritten gider, kavşakta yuvarlak yaylarla döner, otoyola sağdan katılır ve sağdan çıkar. Önüne biri çıkarsa ya da başka araç girerse durur. Her araç ön, arka, sol ve sağ olmak üzere **dört bölgeden** oluşur:
  - Bir bölgeye vurulunca yalnızca o bölge parçalanır: paneller kopar ve **orta boy parçalar** (0.3–0.75 m, panelin boyutuna göre) halinde savrulur. Diğer bölgeler etkilenmez, çatlak efekti yoktur. Zaten parçalanmış bölgeye tekrar vurmak hiçbir şeyi değiştirmez.
  - Ön bölge parçalanınca motor ölür: trafikteki araç durur ve dumanlanır; sürdüğün araç ise yarı hızla gider ve duman çıkarır.
  - Parçalanan bölgenin altındaki **demir iskelet** yalnızca güçlü silahlarla kırılır: **minigun, çift minigun, pompalı, sniper, roket (ve bomba/TNT patlamaları) ve ışın kılıcı**. Tabanca ve AK-47 demire işlemez. Demiri iki bölgede kırılan araç yanıp patlar. Yakın patlama paneli ve demiri birlikte kırar, uzak patlama yalnız panelleri koparır.
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
| `src/terrain.js` | İki katmanlı zemin, tepeler, kırılan çukurlar |
| `src/levels.js` | Dünya düzeni: adalar, yollar, köprü, binalar, park |
| `src/villa.js` | Villa tepesi: plato yüksekliği, kavisli yokuş yol, villa (iç/dış), ekran ve ışıklar, zengin sakin |
| `src/bridge.js` | Asma köprü: ipler (kopma fiziği), sallanma, tabliye destek analizi ve düşüşü |
| `src/arsenal.js` | Cephanelik: kara delik, yıldırım, eritici, yer sarsıcı, yıkım topu, testere diski |
| `src/collapse.js` | Yapısal çökme: bağlantı kopması, gıcırdama, devrilme, eğik düşüş, yerel hasar, suya batma |
| `src/character.js` | Karakter hareketi, voxel çarpışması, yüzme, jetpack |
| `src/handweapons.js`, `src/weapons.js` | Silahlar, şarjör sistemi ve elde görünen modeller |
| `src/audio.js` | Prosedürel ses motoru: silah, şarjör, motor, su ve diğer efektler |
| `src/bombs.js` | Süreli ve uzaktan bombalar |
| `src/npc.js`, `src/cars.js`, `src/planes.js` | İnsanlar, arabalar (trafik, sürüş, bölgesel hasar, momentum), uçaklar |
| `src/doors.js` | Menteşeli ve sürgülü otomatik kapılar: fizik, çarpışma, kırılma, sağ tıkla sürükleme |
| `src/carmodels.js` | 9 araç tipinin modelleri, bölgeler ve demir iskelet |

---

## 🚀 Yayınlama

Depo: https://github.com/onursuay/atahan — `main` dalına push edilince Vercel yeniden derler (`vercel.json`: `npm run build`, çıktı `dist/`).
