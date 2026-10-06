// r2.js — Cloudflare R2 bilan ishlash: vaqtinchalik (imzolangan) yuklash / ko'rish / o'chirish havolalari.
// Qo'shimcha kutubxonasiz, AWS Signature V4 (query) usulida.

const crypto = require('crypto');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || '';
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

module.exports = { enabled, uploadUrl, playUrl, remove, exists, _presign: presign };
