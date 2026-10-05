// server.js — Vector platformasi serveri
// Auth (telefon + parol), Telegram tasdiqlash, Click to'lov, bildirishnomalar, admin panel.

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { connect } = require('./db');
const tg = require('./telegram');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_CHAT = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

const CLICK = {
  serviceId: process.env.CLICK_SERVICE_ID || '111814',
  merchantId: process.env.CLICK_MERCHANT_ID || '64578',
  merchantUserId: process.env.CLICK_MERCHANT_USER_ID || '91152',
  secretKey: process.env.CLICK_SECRET_KEY || '',
};

const PLANS = {
  start: { key: 'start', name: 'Start', title: '1 oylik (Start)', price: 49000, days: 30, perk: 'Asosiy imkoniyatlar' },
  pro: { key: 'pro', name: 'Pro', title: '1 oylik (Pro)', price: 69000, days: 30, perk: 'Mentor bilan ishlash' },
  vip: { key: 'vip', name: 'VIP', title: '1 oylik (VIP)', price: 89000, days: 30, perk: 'Barcha imkoniyatlar + diplom' },
};

if (!process.env.JWT_SECRET) console.warn("⚠️  JWT_SECRET yo'q — server qayta ishga tushsa, hamma tizimdan chiqib ketadi");
if (!CLICK.secretKey) console.warn("⚠️  CLICK_SECRET_KEY yo'q — Click to'lovlari ishlamaydi");
if (!ADMIN_PASSWORD) console.warn("⚠️  ADMIN_PASSWORD yo'q — admin panel o'chiq");

let db;
const users = () => db.col('users');
const payments = () => db.col('payments');
const notifications = () => db.col('notifications');
const feedback = () => db.col('feedback');

// ---------------- Yordamchi funksiyalar ----------------
const now = () => Date.now();
const uid = () => crypto.randomUUID();
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const normalizePhone = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const fullPhone = (p9) => '998' + p9;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signToken(payload, days = 60) {
  const body = b64u({ ...payload, exp: now() + days * 864e5 });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > now() ? p : null;
  } catch { return null; }
}
const bearer = (req) => (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');

function publicUser(u) {
  const active = u.plan && u.planExpiresAt > now();
  return {
    id: u.id,
    phone: '+' + fullPhone(u.phone),
    firstName: u.firstName,
    lastName: u.lastName,
    plan: active ? u.plan : null,
    planName: active ? PLANS[u.plan]?.name || u.plan : null,
    planExpiresAt: active ? u.planExpiresAt : null,
    coins: u.coins || 0,
    telegramLinked: Boolean(u.telegramChatId),
    createdAt: u.createdAt,
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error) => res.status(status).json({ error });

async function auth(req, res, next) {
  const p = readToken(bearer(req));
  if (!p || p.role !== 'user') return fail(res, 401, 'Tizimga qayta kiring');
  const u = await users().findOne({ id: p.uid });
  if (!u) return fail(res, 401, 'Foydalanuvchi topilmadi');
  if (u.blocked) return fail(res, 403, 'Hisobingiz bloklangan. Admin bilan bog\'laning');
  req.user = u;
  next();
}
async function optionalAuth(req, res, next) {
  const p = readToken(bearer(req));
  if (p && p.role === 'user') req.user = await users().findOne({ id: p.uid });
  next();
}
function adminAuth(req, res, next) {
  const p = readToken(bearer(req));
  if (!p || p.role !== 'admin') return fail(res, 401, 'Admin sifatida kiring');
  next();
}

// Oddiy xotiradagi cheklovchi (brute-force'dan himoya)
const hits = new Map();
function limited(key, max, windowMs) {
  const t = now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

async function createNotification({ userId = null, title, body, link = '', type = 'info', telegram = false }) {
  const n = { id: uid(), userId, title, body, link, type, createdAt: now() };
  await notifications().insertOne(n);
  if (telegram) {
    const text = `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}${link ? '\n\n' + link : ''}`;
    if (userId) {
      const u = await users().findOne({ id: userId });
      if (u?.telegramChatId) tg.sendMessage(u.telegramChatId, text);
    } else {
      sendTelegramBroadcast(text);
    }
  }
  return n;
}
async function sendTelegramBroadcast(text) {
  const list = await users().find({ blocked: { $ne: true } });
  for (const u of list) {
    if (!u.telegramChatId) continue;
    await tg.sendMessage(u.telegramChatId, text);
    await new Promise((r) => setTimeout(r, 60)); // Telegram limitlariga rioya
  }
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function notifyAdmin(text) {
  if (ADMIN_CHAT) tg.sendMessage(ADMIN_CHAT, text);
}

// ---------------- Ilova ----------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false })); // Click so'rovlari form ko'rinishida keladi

// CORS — APK ichidagi HTML (file://) serverga murojaat qila olishi uchun
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', platform: 'Vector', db: db?.mode, telegram: tg.enabled, bot: tg.BOT_USERNAME || null, time: now() }));
app.get('/', (req, res) => res.send('🚀 Vector platformasi serveri ishlamoqda'));

tg.mount(app);

// ---------------- Telegram orqali tasdiqlash ----------------
app.post('/api/auth/tg/start', wrap(async (req, res) => {
  if (!tg.enabled) return fail(res, 503, 'Telegram tasdiqlash hali sozlanmagan');
  const phone = normalizePhone(req.body.phone);
  const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
  if (phone.length !== 9) return fail(res, 400, "Telefon raqam noto'g'ri");
  const exists = await users().findOne({ phone });
  if (purpose === 'register' && exists) return fail(res, 409, "Bu raqam allaqachon ro'yxatdan o'tgan. Kirish bo'limidan foydalaning");
  if (purpose === 'reset' && !exists) return fail(res, 404, "Bu raqam bilan hisob topilmadi");
  try {
    res.json(tg.startSession(phone, purpose));
  } catch (e) {
    fail(res, e.status || 400, e.message);
  }
}));

app.get('/api/auth/tg/status/:token', (req, res) => res.json({ status: tg.getStatus(req.params.token) }));

// ---------------- Auth ----------------
app.post('/api/auth/register', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const firstName = String(req.body.firstName || '').trim().slice(0, 40);
  const lastName = String(req.body.lastName || '').trim().slice(0, 40);
  const password = String(req.body.password || '');
  if (phone.length !== 9) return fail(res, 400, "Telefon raqam noto'g'ri");
  if (firstName.length < 2) return fail(res, 400, 'Ismingizni kiriting');
  if (lastName.length < 2) return fail(res, 400, 'Familiyangizni kiriting');
  if (password.length < 6) return fail(res, 400, "Parol kamida 6 ta belgidan iborat bo'lsin");
  if (await users().findOne({ phone })) return fail(res, 409, "Bu raqam allaqachon ro'yxatdan o'tgan");

  const tgInfo = tg.consume(req.body.verifyToken, phone, 'register');
  if (!tgInfo) return fail(res, 400, 'Raqam tasdiqlanmagan yoki tasdiqlash muddati tugagan');

  const u = {
    id: uid(), phone, firstName, lastName,
    password: hashPassword(password),
    telegramChatId: tgInfo.chatId || null,
    plan: null, planExpiresAt: null, coins: 0,
    blocked: false, notifReadAt: now(), createdAt: now(),
  };
  await users().insertOne(u);
  tg.sendMessage(u.telegramChatId, `🎉 Xush kelibsiz, ${escapeHtml(firstName)}! Vector'da hisobingiz yaratildi.\n\nTo'lovlar va yangiliklar haqida shu yerda xabar beramiz.`);
  notifyAdmin(`🆕 Yangi foydalanuvchi: ${escapeHtml(firstName)} ${escapeHtml(lastName)} (+${fullPhone(phone)})`);
  res.json({ token: signToken({ role: 'user', uid: u.id }), user: publicUser(u) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length !== 9) return fail(res, 400, "Telefon raqam noto'g'ri");
  if (limited('login:' + phone, 8, 10 * 60 * 1000)) return fail(res, 429, "Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring");
  const u = await users().findOne({ phone });
  if (!u || !checkPassword(req.body.password, u.password)) return fail(res, 401, "Telefon raqam yoki parol noto'g'ri");
  if (u.blocked) return fail(res, 403, "Hisobingiz bloklangan. Admin bilan bog'laning");
  await users().updateOne({ id: u.id }, { lastLoginAt: now() });
  res.json({ token: signToken({ role: 'user', uid: u.id }), user: publicUser(u) });
}));

app.post('/api/auth/reset-password', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || '');
  if (password.length < 6) return fail(res, 400, "Parol kamida 6 ta belgidan iborat bo'lsin");
  const u = await users().findOne({ phone });
  if (!u) return fail(res, 404, 'Hisob topilmadi');
  const tgInfo = tg.consume(req.body.verifyToken, phone, 'reset');
  if (!tgInfo) return fail(res, 400, 'Raqam tasdiqlanmagan yoki tasdiqlash muddati tugagan');
  await users().updateOne({ id: u.id }, { password: hashPassword(password), telegramChatId: tgInfo.chatId || u.telegramChatId });
  tg.sendMessage(tgInfo.chatId, '🔐 Vector hisobingiz paroli yangilandi. Agar bu siz bo\'lmasangiz, darhol admin bilan bog\'laning.');
  res.json({ token: signToken({ role: 'user', uid: u.id }), user: publicUser({ ...u, telegramChatId: tgInfo.chatId }) });
}));

app.get('/api/auth/me', wrap(auth), (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/change-password', wrap(auth), wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!checkPassword(oldPassword, req.user.password)) return fail(res, 400, "Joriy parol noto'g'ri");
  if (String(newPassword || '').length < 6) return fail(res, 400, "Yangi parol kamida 6 ta belgidan iborat bo'lsin");
  await users().updateOne({ id: req.user.id }, { password: hashPassword(newPassword) });
  res.json({ ok: true });
}));

// ---------------- Tariflar va to'lov ----------------
app.get('/api/plans', (req, res) => res.json({ plans: Object.values(PLANS) }));

app.post('/api/payments/create', wrap(auth), wrap(async (req, res) => {
  const plan = PLANS[req.body.plan];
  if (!plan) return fail(res, 400, 'Tarif topilmadi');
  if (!CLICK.secretKey) return fail(res, 503, "To'lov tizimi hali sozlanmagan");
  const id = String(await db.nextSeq('payment'));
  const p = {
    id, userId: req.user.id, phone: req.user.phone, plan: plan.key, amount: plan.price,
    provider: 'click', status: 'pending', createdAt: now(),
  };
  await payments().insertOne(p);
  const returnUrl = `${PUBLIC_URL}/payment/return?id=${id}`;
  const payUrl = 'https://my.click.uz/services/pay?' + new URLSearchParams({
    service_id: CLICK.serviceId,
    merchant_id: CLICK.merchantId,
    amount: String(plan.price),
    transaction_param: id,
    return_url: returnUrl,
  }).toString();
  res.json({ paymentId: id, payUrl, returnUrl });
}));

app.get('/api/payments/:id', wrap(auth), wrap(async (req, res) => {
  const p = await payments().findOne({ id: req.params.id, userId: req.user.id });
  if (!p) return fail(res, 404, "To'lov topilmadi");
  res.json({ id: p.id, status: p.status, plan: p.plan, amount: p.amount });
}));

app.get('/payment/return', (req, res) => {
  const id = String(req.query.id || '').replace(/[^0-9]/g, '');
  const deep = `vectorapp://payment?id=${id}`;
  const intent = `intent://payment?id=${id}#Intent;scheme=vectorapp;package=uz.vector.app;end`;
  res.send(`<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vector — to'lov</title><style>body{margin:0;font-family:-apple-system,Roboto,sans-serif;background:#F1F2F5;color:#111318;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;border-radius:18px;padding:28px 22px;max-width:340px;width:88%;text-align:center;box-shadow:0 2px 10px rgba(20,20,40,.06)}
h1{font-size:21px;margin:12px 0 8px}p{color:#8A8D95;font-size:14.5px;line-height:1.5;margin:0 0 20px}
a{display:block;background:#1568EC;color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px}</style></head>
<body><div class="c"><div style="font-size:42px">🧾</div><h1>To'lov yakunlandi</h1><p>Natijani ko'rish uchun Vector ilovasiga qayting.</p>
<a href="${intent}">Ilovaga qaytish</a></div><script>setTimeout(function(){location.href=${JSON.stringify(deep)}},300)</script></body></html>`);
});

// ---------------- Click SHOP API (Prepare / Complete) ----------------
function clickReply(res, body, error, note, extra = {}) {
  res.json({
    click_trans_id: body.click_trans_id,
    merchant_trans_id: body.merchant_trans_id,
    error,
    error_note: note,
    ...extra,
  });
}

async function activatePlan(payment) {
  const u = await users().findOne({ id: payment.userId });
  if (!u) return;
  const plan = PLANS[payment.plan];
  const base = u.planExpiresAt && u.planExpiresAt > now() ? u.planExpiresAt : now();
  const expires = base + plan.days * 864e5;
  await users().updateOne({ id: u.id }, { plan: plan.key, planExpiresAt: expires });
  await createNotification({
    userId: u.id,
    type: 'payment',
    title: "🎉 To'lov qabul qilindi",
    body: `${plan.name} obunasi uchun ${plan.price.toLocaleString('ru-RU')} so'm to'lovingiz muvaffaqiyatli amalga oshirildi. Obuna ${new Date(expires).toLocaleDateString('ru-RU')} gacha faol. Rahmat!`,
    telegram: true,
  });
  notifyAdmin(`💰 Yangi to'lov: ${plan.name} — ${plan.price} so'm\n${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)} (+${fullPhone(u.phone)})`);
}

app.post('/api/click/prepare', wrap(async (req, res) => {
  const b = req.body;
  const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];
  if (need.some((k) => b[k] === undefined)) return clickReply(res, b, -8, 'Error in request from click');
  const sign = md5(`${b.click_trans_id}${b.service_id}${CLICK.secretKey}${b.merchant_trans_id}${b.amount}${b.action}${b.sign_time}`);
  if (!CLICK.secretKey || sign !== b.sign_string || String(b.service_id) !== CLICK.serviceId) return clickReply(res, b, -1, 'SIGN CHECK FAILED!');
  if (String(b.action) !== '0') return clickReply(res, b, -3, 'Action not found');

  const p = await payments().findOne({ id: String(b.merchant_trans_id) });
  if (!p) return clickReply(res, b, -5, 'User does not exist');
  if (p.status === 'paid') return clickReply(res, b, -4, 'Already paid');
  if (p.status === 'cancelled') return clickReply(res, b, -9, 'Transaction cancelled');
  if (Math.abs(Number(b.amount) - p.amount) > 0.01) return clickReply(res, b, -2, 'Incorrect parameter amount');

  let prepareId = p.prepareId;
  if (!prepareId || String(p.clickTransId) !== String(b.click_trans_id)) {
    prepareId = await db.nextSeq('prepare');
    await payments().updateOne({ id: p.id }, { prepareId, clickTransId: String(b.click_trans_id), clickPaydocId: b.click_paydoc_id, status: 'preparing' });
  }
  clickReply(res, b, 0, 'Success', { merchant_prepare_id: prepareId });
}));

app.post('/api/click/complete', wrap(async (req, res) => {
  const b = req.body;
  const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'merchant_prepare_id', 'amount', 'action', 'sign_time', 'sign_string'];
  if (need.some((k) => b[k] === undefined)) return clickReply(res, b, -8, 'Error in request from click');
  const sign = md5(`${b.click_trans_id}${b.service_id}${CLICK.secretKey}${b.merchant_trans_id}${b.merchant_prepare_id}${b.amount}${b.action}${b.sign_time}`);
  if (!CLICK.secretKey || sign !== b.sign_string || String(b.service_id) !== CLICK.serviceId) return clickReply(res, b, -1, 'SIGN CHECK FAILED!');
  if (String(b.action) !== '1') return clickReply(res, b, -3, 'Action not found');

  const p = await payments().findOne({ id: String(b.merchant_trans_id) });
  if (!p) return clickReply(res, b, -5, 'User does not exist');
  if (String(p.prepareId) !== String(b.merchant_prepare_id)) return clickReply(res, b, -6, 'Transaction does not exist');
  if (p.status === 'paid') return clickReply(res, b, -4, 'Already paid', { merchant_confirm_id: p.confirmId });
  if (p.status === 'cancelled') return clickReply(res, b, -9, 'Transaction cancelled');
  if (Math.abs(Number(b.amount) - p.amount) > 0.01) return clickReply(res, b, -2, 'Incorrect parameter amount');

  if (Number(b.error) < 0) {
    await payments().updateOne({ id: p.id }, { status: 'cancelled', cancelledAt: now(), clickError: String(b.error_note || b.error) });
    return clickReply(res, b, -9, 'Transaction cancelled');
  }

  const confirmId = await db.nextSeq('confirm');
  await payments().updateOne({ id: p.id }, { status: 'paid', paidAt: now(), confirmId });
  await activatePlan(p);
  clickReply(res, b, 0, 'Success', { merchant_confirm_id: confirmId });
}));

// ---------------- Bildirishnomalar ----------------
async function listFor(user, extra = {}) {
  const q = { userId: { $in: user ? [null, user.id] : [null] }, ...extra };
  return notifications().find(q, { sort: { createdAt: -1 }, limit: 50 });
}

app.get('/api/notifications', wrap(optionalAuth), wrap(async (req, res) => {
  const list = await listFor(req.user);
  const readAt = req.user?.notifReadAt || 0;
  res.json({
    items: list.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, type: n.type, createdAt: n.createdAt, unread: n.createdAt > readAt })),
    unread: list.filter((n) => n.createdAt > readAt).length,
  });
}));

app.post('/api/notifications/read-all', wrap(auth), wrap(async (req, res) => {
  await users().updateOne({ id: req.user.id }, { notifReadAt: now() });
  res.json({ ok: true });
}));

// Android fon xizmati shu yerdan yangi bildirishnomalarni oladi
app.get('/api/notifications/poll', wrap(auth), wrap(async (req, res) => {
  const since = req.query.since !== undefined ? (Number(req.query.since) || 0) : now();
  const list = await notifications().find(
    { userId: { $in: [null, req.user.id] }, createdAt: { $gt: since } },
    { sort: { createdAt: 1 }, limit: 10 }
  );
  res.json({ items: list.map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt })) });
}));

// ---------------- Takliflar ----------------
app.post('/api/feedback', wrap(optionalAuth), wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (text.length < 3) return fail(res, 400, 'Taklifingizni yozing');
  if (limited('fb:' + (req.user?.id || req.ip), 5, 60 * 60 * 1000)) return fail(res, 429, "Juda ko'p xabar. Keyinroq urinib ko'ring");
  const f = {
    id: uid(), text, userId: req.user?.id || null,
    name: req.user ? `${req.user.firstName} ${req.user.lastName}` : 'Mehmon',
    phone: req.user ? '+' + fullPhone(req.user.phone) : '', createdAt: now(),
  };
  await feedback().insertOne(f);
  notifyAdmin(`💬 Yangi taklif (${escapeHtml(f.name)} ${f.phone}):\n\n${escapeHtml(text)}`);
  res.json({ ok: true });
}));

// ---------------- Admin panel ----------------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return fail(res, 503, "ADMIN_PASSWORD serverda sozlanmagan");
  if (limited('admin:' + req.ip, 10, 15 * 60 * 1000)) return fail(res, 429, "Juda ko'p urinish");
  const a = Buffer.from(String(req.body.password || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 401, "Parol noto'g'ri");
  res.json({ token: signToken({ role: 'admin' }, 1) });
});

app.get('/api/admin/stats', adminAuth, wrap(async (req, res) => {
  const t = now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const paid = await payments().find({ status: 'paid' });
  res.json({
    users: await users().count({}),
    newToday: await users().count({ createdAt: { $gte: dayStart.getTime() } }),
    activeSubs: await users().count({ planExpiresAt: { $gt: t } }),
    revenue: paid.reduce((s, p) => s + p.amount, 0),
    revenueToday: paid.filter((p) => p.paidAt >= dayStart.getTime()).reduce((s, p) => s + p.amount, 0),
    paidCount: paid.length,
    telegram: tg.enabled,
    click: Boolean(CLICK.secretKey),
    db: db.mode,
  });
}));

app.get('/api/admin/users', adminAuth, wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  let list = await users().find({}, { sort: { createdAt: -1 } });
  if (q) list = list.filter((u) => `${u.firstName} ${u.lastName} ${u.phone}`.toLowerCase().includes(q.replace(/^\+?998/, '')));
  res.json({ items: list.slice(0, 300).map((u) => ({ ...publicUser(u), blocked: Boolean(u.blocked), lastLoginAt: u.lastLoginAt || null })), total: list.length });
}));

app.post('/api/admin/users/:id/plan', adminAuth, wrap(async (req, res) => {
  const u = await users().findOne({ id: req.params.id });
  if (!u) return fail(res, 404, 'Topilmadi');
  if (!req.body.plan) {
    await users().updateOne({ id: u.id }, { plan: null, planExpiresAt: null });
    return res.json({ ok: true });
  }
  const plan = PLANS[req.body.plan];
  if (!plan) return fail(res, 400, 'Tarif topilmadi');
  const days = Math.max(1, Math.min(3650, Number(req.body.days) || plan.days));
  const expires = now() + days * 864e5;
  await users().updateOne({ id: u.id }, { plan: plan.key, planExpiresAt: expires });
  await createNotification({ userId: u.id, type: 'payment', title: `⭐ ${plan.name} obunasi faollashtirildi`, body: `Sizga ${days} kunlik ${plan.name} obunasi berildi. Yoqimli o'qish!`, telegram: true });
  res.json({ ok: true });
}));

app.post('/api/admin/users/:id/block', adminAuth, wrap(async (req, res) => {
  const ok = await users().updateOne({ id: req.params.id }, { blocked: Boolean(req.body.blocked) });
  if (!ok) return fail(res, 404, 'Topilmadi');
  res.json({ ok: true });
}));

app.get('/api/admin/payments', adminAuth, wrap(async (req, res) => {
  const list = await payments().find({}, { sort: { createdAt: -1 }, limit: 300 });
  res.json({ items: list.map((p) => ({ ...p, phone: '+' + fullPhone(p.phone) })) });
}));

app.get('/api/admin/notifications', adminAuth, wrap(async (req, res) => {
  res.json({ items: await notifications().find({}, { sort: { createdAt: -1 }, limit: 100 }) });
}));

app.post('/api/admin/notify', adminAuth, wrap(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 1500);
  const link = String(req.body.link || '').trim().slice(0, 300);
  if (!title || !body) return fail(res, 400, 'Sarlavha va matnni kiriting');
  let userId = null;
  if (req.body.phone) {
    const u = await users().findOne({ phone: normalizePhone(req.body.phone) });
    if (!u) return fail(res, 404, 'Bu raqamli foydalanuvchi topilmadi');
    userId = u.id;
  }
  const n = await createNotification({ userId, title, body, link, type: 'news', telegram: Boolean(req.body.telegram) });
  res.json({ ok: true, notification: n });
}));

app.get('/api/admin/feedback', adminAuth, wrap(async (req, res) => {
  res.json({ items: await feedback().find({}, { sort: { createdAt: -1 }, limit: 200 }) });
}));

// ---------------- Xatolar ----------------
app.use((req, res) => fail(res, 404, 'Topilmadi'));
app.use((err, req, res, next) => {
  console.error('Server xatosi:', err);
  if (req.path.startsWith('/api/click/')) return clickReply(res, req.body || {}, -7, 'Failed to update user');
  fail(res, 500, 'Serverda xatolik yuz berdi');
});

connect()
  .then((d) => {
    db = d;
    app.listen(PORT, () => console.log(`🚀 Vector platformasi server ${PORT} portida ishlamoqda`));
  })
  .catch((e) => {
    console.error("Bazaga ulanib bo'lmadi:", e);
    process.exit(1);
  });

module.exports = { app, PLANS };
