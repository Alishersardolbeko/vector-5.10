# Vector — ishga tushirish qo'llanmasi

Bu papka Vector ilovasining serveri: ro'yxatdan o'tish, Telegram orqali tasdiqlash, Click to'lov, bildirishnomalar va admin panel.

## 1. MongoDB (bepul baza) — majburiy

Render'ning bepul serveri har qayta ishga tushganda fayllarni o'chiradi. Baza bo'lmasa, foydalanuvchilar va to'lovlar yo'qolib ketadi.

1. https://www.mongodb.com/cloud/atlas/register — ro'yxatdan o'ting (Google bilan ham bo'ladi).
2. **Create** → **M0 Free** klasterni tanlang.
3. **Database Access** → foydalanuvchi va parol yarating.
4. **Network Access** → **Add IP Address** → `0.0.0.0/0` (Allow access from anywhere).
5. **Connect** → **Drivers** → ulanish satrini nusxalang:
   `mongodb+srv://USER:PAROL@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. Telegram bot

1. Telegramda **@BotFather** → `/newbot` → nom va username bering (masalan `VectorUzBot`).
2. Bergan **token**ni saqlang.
3. Ixtiyoriy: o'zingizning chat ID'ingizni bilish uchun **@userinfobot**'ga yozing — shunda yangi to'lov va takliflar haqida sizga xabar keladi.

## 3. Render → Environment

Render'dagi Vector servisingizda **Environment** bo'limiga quyidagilarni qo'shing:

| Kalit | Qiymat |
|---|---|
| `PUBLIC_URL` | `https://SIZNING-SERVER.onrender.com` (Render bergan manzil) |
| `JWT_SECRET` | istalgan uzun tasodifiy matn (kamida 32 belgi) |
| `ADMIN_PASSWORD` | admin panel uchun kuchli parol |
| `MONGODB_URI` | 1-qadamdagi ulanish satri |
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_BOT_USERNAME` | bot username, `@` belgisisiz |
| `ADMIN_TELEGRAM_CHAT_ID` | (ixtiyoriy) sizning chat ID |
| `CLICK_SERVICE_ID` | `111814` |
| `CLICK_MERCHANT_ID` | `64578` |
| `CLICK_MERCHANT_USER_ID` | `91152` |
| `CLICK_SECRET_KEY` | Click bergan SECRET_KEY |

⚠️ SECRET_KEY va parollarni hech qachon GitHub'ga, HTML'ga yoki ilovaga yozmang — faqat Render Environment'ga.

## 4. Serverni yangilash

GitHub'dagi Vector repozitoriyangizdagi eski server fayllarini shu papkadagilar bilan almashtiring:
`server.js`, `db.js`, `telegram.js`, `package.json`, `public/admin.html`, `.gitignore`.

Render avtomatik qayta deploy qiladi. Render sozlamalari:
- **Build Command:** `npm install`
- **Start Command:** `npm start`

Tekshirish: brauzerda `https://SIZNING-SERVER.onrender.com/health` oching. Javobda `"db":"mongo"` va `"telegram":true` bo'lishi kerak.
Loglarda `🤖 Telegram webhook: ulandi` chiqishi kerak.

## 5. Click kabinetini sozlash

https://merchant.click.uz → **Сервисы** → Vector servisini tahrirlash:

- **Prepare URL:** `https://SIZNING-SERVER.onrender.com/api/click/prepare`
- **Complete URL:** `https://SIZNING-SERVER.onrender.com/api/click/complete`

Saqlang. Birinchi marta kichik summada (Start tarifi) haqiqiy to'lov qilib sinab ko'ring.

## 6. Server uxlab qolmasligi uchun

https://uptimerobot.com (bepul) → **New Monitor** → HTTP(s) → manzil: `https://SIZNING-SERVER.onrender.com/health`, interval 5 daqiqa.
Ilova server uxlasa ham ochiladi, lekin to'lov va Telegram javoblari tezroq bo'ladi.

## 7. Admin panel

`https://SIZNING-SERVER.onrender.com/admin` — `ADMIN_PASSWORD` bilan kiring.

- **Statistika** — foydalanuvchilar, faol obunalar, tushum
- **Foydalanuvchilar** — qidirish, qo'lda obuna berish, bloklash
- **To'lovlar** — barcha Click to'lovlari va holati
- **Bildirishnoma** — hammaga yoki bitta foydalanuvchiga xabar (ilovaga + Telegram'ga)
- **Takliflar** — ilovadagi "Bizga taklifingiz" bo'limidan kelgan xabarlar

## 8. Bildirishnomalar qanday ishlaydi

- **Ilova ichida** — Bildirishnoma bo'limida, qo'ng'iroqchada qizil nuqta.
- **Telegram orqali** — darhol yetib boradi (foydalanuvchi bot orqali ro'yxatdan o'tgani uchun).
- **Telefon bildirishnomasi** — ilova fonda har ~15 daqiqada serverni tekshiradi va yangi xabarni telefon panelida ko'rsatadi. Android batareya tejash rejimida bu biroz kechikishi mumkin.

## 9. Ilova (APK)

- APK'ni telefonga yuklab, o'rnating ("Noma'lum manbalar"ga ruxsat bering).
- Server manzilini o'rnatish: **Profil → "Ilova versiyasi" yozuviga 7 marta bosing** → Render manzilingizni kiriting.
- Yangilanishlarni bir xil imzo bilan chiqarish uchun `vector-release.keystore` faylini va parolini **yo'qotmang** — busiz eski ilova ustiga yangisini o'rnatib bo'lmaydi.


## 10. Video darslar (Cloudflare R2) — v2

1. dash.cloudflare.com → **R2 Object Storage** → to'lov kartasini (Visa/Mastercard) qo'shib R2'ni yoqing.
2. **Create bucket** → nom: `vector-videos` → Create.
3. Bucket → **Settings → CORS Policy** → admin panelning **Tizim holati** sahifasidagi matnni joylang.
4. R2 sahifasida **API Tokens → Create API token** → ruxsat: **Object Read & Write**, faqat `vector-videos` bucket → Create.
   Chiqqan **Access Key ID** va **Secret Access Key**ni saqlab qo'ying (faqat bir marta ko'rsatiladi). **Account ID** R2 bosh sahifasida yozilgan.
5. Render → Environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=vector-videos`.
6. Admin panel → **Kurslar va darslar** → kurs yarating → dars qo'shing → «Video yuklash».

## 11. Maktablar ro'yxati

Admin panel → **Maktablar** → viloyat va tumanni tanlab, «1-45, Prezident maktabi» kabi yozing.
Ro'yxat bo'sh tumanlarda o'quvchi maktab raqamini o'zi yozadi.

## 12. Tarif narxlari

`server.js` faylining boshida `PLANS` bo'limida. O'zgartirsangiz, ilova narxlarni serverdan o'zi oladi.
