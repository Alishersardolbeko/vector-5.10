// telegram.js — Telegram bot: raqamni kontakt ulashish orqali tasdiqlash va xabar yuborish (bepul)

const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ||
  crypto.createHash('sha256').update('vector-webhook:' + (BOT_TOKEN || '')).digest('hex').slice(0, 40);

const TTL = 10 * 60 * 1000;
const sessions = new Map(); // token -> { phone, purpose, status, chatId, tgUserId, createdAt }

const enabled = Boolean(BOT_TOKEN && BOT_USERNAME);

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '').slice(-9);
}

async function call(method, body) {
  if (!enabled) return { ok: false, description: 'bot sozlanmagan' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

function sendMessage(chatId, text, extra = {}) {
  if (!chatId) return Promise.resolve({ ok: false });
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.createdAt > TTL) sessions.delete(k);
}, 60 * 1000).unref();

function startSession(phone, purpose) {
  const p = normalizePhone(phone);
  let recent = 0;
  for (const s of sessions.values()) if (s.phone === p && Date.now() - s.createdAt < 60000) recent++;
  if (recent >= 3) {
    const e = new Error("Juda ko'p urinish. 1 daqiqadan keyin qayta urinib ko'ring");
    e.status = 429;
    throw e;
  }
  const token = crypto.randomBytes(12).toString('hex');
  sessions.set(token, { phone: p, purpose, status: 'pending', chatId: null, tgUserId: null, createdAt: Date.now() });
  return {
    token,
    botUrl: `https://t.me/${BOT_USERNAME}?start=${token}`,
    expiresIn: TTL / 1000,
  };
}

function getStatus(token) {
  const s = sessions.get(token);
  return s ? s.status : 'expired';
}

// Tasdiqlangan sessiyani bir marta ishlatish. Muvaffaqiyatli bo'lsa { chatId, tgUserId } qaytaradi.
function consume(token, phone, purpose) {
  const s = token && sessions.get(token);
  if (!s || s.status !== 'verified' || s.purpose !== purpose) return null;
  if (normalizePhone(phone) !== s.phone) return null;
  sessions.delete(token);
  return { chatId: s.chatId, tgUserId: s.tgUserId };
}

async function handleUpdate(update) {
  const msg = update && update.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;

  if (msg.text && msg.text.startsWith('/start')) {
    const token = msg.text.split(' ')[1];
    if (!token) {
      return sendMessage(chatId,
        "👋 Assalomu alaykum! Bu <b>Vector</b> ta'lim platformasining rasmiy boti.\n\n" +
        "Bu yerda telefon raqamingizni tasdiqlaysiz va to'lovlar, yangi darslar haqida xabarlar olasiz.\n\n" +
        "Ro'yxatdan o'tish uchun Vector ilovasini oching.");
    }
    const s = sessions.get(token);
    if (!s) return sendMessage(chatId, "⏳ Bu havola eskirgan. Ilovaga qaytib, qaytadan urinib ko'ring.");
    s.chatId = chatId;
    s.tgUserId = msg.from && msg.from.id;
    return sendMessage(chatId,
      (s.purpose === 'reset' ? '🔐 Parolni tiklash' : "📝 Ro'yxatdan o'tish") +
      '\n\nRaqamingizni tasdiqlash uchun pastdagi <b>«📱 Raqamni ulashish»</b> tugmasini bosing 👇', {
        reply_markup: {
          keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
  }

  if (msg.contact) {
    if (!msg.from || msg.contact.user_id !== msg.from.id) {
      return sendMessage(chatId, "Iltimos, boshqa odamning emas, o'zingizning raqamingizni tugma orqali ulashing.");
    }
    let s = null;
    for (const v of sessions.values()) if (v.chatId === chatId && v.status === 'pending') s = v;
    if (!s) {
      return sendMessage(chatId, "Faol so'rov topilmadi. Ilovadan qaytadan boshlang.", {
        reply_markup: { remove_keyboard: true },
      });
    }
    if (normalizePhone(msg.contact.phone_number) !== s.phone) {
      s.status = 'mismatch';
      return sendMessage(chatId,
        "❌ Telegramdagi raqamingiz ilovada yozilgan raqamga mos kelmadi.\n\nIlovada Telegram'ingiz ulangan raqamni kiriting.", {
          reply_markup: { remove_keyboard: true },
        });
    }
    s.status = 'verified';
    return sendMessage(chatId, '✅ Raqamingiz tasdiqlandi! Endi Vector ilovasiga qayting.', {
      reply_markup: { remove_keyboard: true },
    });
  }
}

function mount(app) {
  app.post('/api/telegram/webhook', (req, res) => {
    if (req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) return res.sendStatus(403);
    res.sendStatus(200);
    handleUpdate(req.body).catch((e) => console.error('Telegram xato:', e));
  });

  if (!enabled) {
    console.warn("⚠️  TELEGRAM_BOT_TOKEN yoki TELEGRAM_BOT_USERNAME yo'q — Telegram tasdiqlash o'chiq");
    return;
  }
  if (!PUBLIC_URL) {
    console.warn("⚠️  PUBLIC_URL yo'q — Telegram webhook o'rnatilmadi");
    return;
  }
  call('setWebhook', {
    url: `${PUBLIC_URL}/api/telegram/webhook`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message'],
  }).then((r) => console.log('🤖 Telegram webhook:', r.ok ? 'ulandi' : r.description));
}

module.exports = { enabled, BOT_USERNAME, mount, startSession, getStatus, consume, sendMessage, normalizePhone, _handleUpdate: handleUpdate, _sessions: sessions };
