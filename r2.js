// r2.js — Cloudflare R2 bilan ishlash: vaqtinchalik (imzolangan) yuklash / ko'rish / o'chirish havolalari.
// Qo'shimcha kutubxonasiz, AWS Signature V4 (query) usulida.

const crypto = require('crypto');

const RAW = { a: process.env.R2_ACCOUNT_ID || '', k: process.env.R2_ACCESS_KEY_ID || '', s: process.env.R2_SECRET_ACCESS_KEY || '', b: process.env.R2_BUCKET || '' };
const ACCOUNT_ID = RAW.a.trim();
const ACCESS_KEY = RAW.k.trim();
const SECRET_KEY = RAW.s.trim();
const BUCKET = RAW.b.trim();
// R2_ENDPOINT faqat sinov uchun (masalan http://localhost:9000); odatda bo'sh qoldiriladi
const ENDPOINT = process.env.R2_ENDPOINT ? new URL(process.env.R2_ENDPOINT) : null;
const HOST = ENDPOINT ? ENDPOINT.host : ACCOUNT_ID ? `${ACCOUNT_ID}.r2.cloudflarestorage.com` : '';
const PROTO = ENDPOINT ? ENDPOINT.protocol.replace(':', '') : 'https';

const enabled = Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET);

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function presign(method, key, expiresSec, o = {}) {
  const t = o.date || new Date();
  const amzDate = t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const region = o.region || 'auto';
  const host = o.host || HOST;
  const scope = `${date}/${region}/s3/aws4_request`;
  const uri = (o.bucketInPath === false ? '' : '/' + BUCKET) + '/' + String(key).split('/').map(enc).join('/');
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${o.accessKey || ACCESS_KEY}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(60, expiresSec | 0))),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonical = [method, uri, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let k = hmac('AWS4' + (o.secretKey || SECRET_KEY), date);
  k = hmac(k, region); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return `${o.host ? 'https' : PROTO}://${host}${uri}?${query}&X-Amz-Signature=${sig}`;
}

const uploadUrl = (key) => presign('PUT', key, 6 * 3600);   // 6 soat — katta videolar uchun
const playUrl = (key) => presign('GET', key, 3 * 3600);     // 3 soat
async function remove(key) {
  if (!enabled || !key) return false;
  try { const r = await fetch(presign('DELETE', key, 300), { method: 'DELETE' }); return r.ok || r.status === 404; }
  catch { return false; }
}
async function exists(key) {
  if (!enabled || !key) return false;
  try { const r = await fetch(presign('HEAD', key, 300), { method: 'HEAD' }); return r.ok; }
  catch { return false; }
}

// Server tomonidan to'liq tekshiruv: kalitlar, bucket va CORS. Brauzersiz, shuning uchun aniq xatoni ko'rsatadi.
async function diagnose(origin) {
  const steps = [];
  const add = (name, ok, detail) => steps.push({ name, ok, detail });
  const xmlCode = (t) => ((t || '').match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
  const hint = {
    SignatureDoesNotMatch: "R2_SECRET_ACCESS_KEY noto'g'ri (ortiqcha bo'sh joy yoki boshqa tokenning kaliti bo'lishi mumkin)",
    InvalidAccessKeyId: "R2_ACCESS_KEY_ID noto'g'ri yoki token o'chirilgan",
    NoSuchBucket: "R2_BUCKET nomi bucket nomiga mos emas",
    AccessDenied: "Token'da bu bucket uchun «Object Read & Write» ruxsati yo'q",
    Unauthorized: "Kalitlar noto'g'ri",
  };
  const vars = { R2_ACCOUNT_ID: ACCOUNT_ID, R2_ACCESS_KEY_ID: ACCESS_KEY, R2_SECRET_ACCESS_KEY: SECRET_KEY, R2_BUCKET: BUCKET };
  const missing = Object.keys(vars).filter((k) => !vars[k]);
  if (missing.length) { add('Sozlamalar', false, missing.join(', ') + ' kiritilmagan'); return { ok: false, steps }; }
  if (!/^[0-9a-f]{32}$/.test(ACCOUNT_ID)) add('Account ID', false, "R2_ACCOUNT_ID 32 belgili bo'lishi kerak (faqat 0-9, a-f). Hozir: " + ACCOUNT_ID.length + ' belgi. S3 endpoint manzilidagi https:// va .r2. orasidagi qismni yozing');
  else add('Sozlamalar', true, 'Barcha 4 ta qiymat kiritilgan');
  if (ACCESS_KEY.length !== 32) add('Access Key ID', false, `Odatda 32 belgi bo'ladi, hozir ${ACCESS_KEY.length} ta. «Token value» emas, «Access Key ID» ni yozing`);
  if (SECRET_KEY.length !== 64) add('Secret Access Key', false, `Odatda 64 belgi bo'ladi, hozir ${SECRET_KEY.length} ta`);

  const key = '_vector-test/' + Date.now() + '.txt';
  try {
    const r = await fetch(presign('PUT', key, 300), { method: 'PUT', body: 'vector', headers: { 'Content-Type': 'text/plain' } });
    const t = r.ok ? '' : await r.text();
    const code = xmlCode(t);
    add('Yozish (PUT)', r.ok, r.ok ? 'R2 kalitlarni qabul qildi' : `${r.status} ${code} — ${hint[code] || t.slice(0, 160)}`);
    if (r.ok) {
      const g = await fetch(presign('GET', key, 300));
      add("O'qish (GET)", g.ok, g.ok ? 'Video ijrosi ishlaydi' : String(g.status));
      await fetch(presign('DELETE', key, 300), { method: 'DELETE' });
    }
  } catch (e) {
    add('Ulanish', false, "R2 serveriga ulanib bo'lmadi: " + e.message + ' — R2_ACCOUNT_ID ni tekshiring');
  }

  if (origin) {
    try {
      const o = await fetch(presign('PUT', key, 300), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
      const allow = o.headers.get('access-control-allow-origin');
      const ok = allow === origin || allow === '*';
      add('CORS', ok, ok ? `${origin} ga ruxsat bor` : `${origin} uchun ruxsat yo'q (javob: ${o.status}). Bucket → Settings → CORS Policy'ni saqlang va 1-2 daqiqa kuting`);
    } catch (e) { add('CORS', false, e.message); }
  }
  return { ok: steps.every((s) => s.ok), steps };
}

module.exports = { enabled, uploadUrl, playUrl, remove, exists, diagnose, _presign: presign };
