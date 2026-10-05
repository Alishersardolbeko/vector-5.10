// db.js — MongoDB (asosiy) yoki JSON fayl (faqat sinov uchun) bilan ishlaydigan oddiy qatlam.
// Render'ning bepul rejasida fayl tizimi har qayta ishga tushganda tozalanadi,
// shuning uchun haqiqiy ishda MONGODB_URI albatta kerak.

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['users', 'payments', 'notifications', 'feedback', 'counters'];

function matches(doc, query) {
  for (const [k, cond] of Object.entries(query || {})) {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      if ('$gt' in cond && !(v > cond.$gt)) return false;
      if ('$gte' in cond && !(v >= cond.$gte)) return false;
      if ('$lt' in cond && !(v < cond.$lt)) return false;
      if ('$ne' in cond && v === cond.$ne) return false;
    } else if (v !== cond) return false;
  }
  return true;
}

function strip(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

// ---------- JSON fayl rejimi ----------
function createFileDb() {
  const dir = path.join(__dirname, 'data');
  const file = path.join(dir, 'db.json');
  fs.mkdirSync(dir, { recursive: true });
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  for (const c of COLLECTIONS) data[c] = data[c] || [];

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(data)), 50);
  };

  const col = (name) => ({
    async findOne(q) { const d = data[name].find((x) => matches(x, q)); return d ? { ...d } : null; },
    async find(q, opts = {}) {
      let list = data[name].filter((x) => matches(x, q));
      if (opts.sort) {
        const [k, dir] = Object.entries(opts.sort)[0];
        list.sort((a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0));
      }
      if (opts.skip) list = list.slice(opts.skip);
      if (opts.limit) list = list.slice(0, opts.limit);
      return list.map((x) => ({ ...x }));
    },
    async insertOne(doc) { data[name].push({ ...doc }); save(); return doc; },
    async updateOne(q, set) {
      const d = data[name].find((x) => matches(x, q));
      if (!d) return false;
      Object.assign(d, set); save(); return true;
    },
    async count(q) { return data[name].filter((x) => matches(x, q)).length; },
  });

  return {
    mode: 'file',
    col,
    async nextSeq(name) {
      const c = data.counters.find((x) => x.id === name);
      if (c) { c.seq += 1; save(); return c.seq; }
      data.counters.push({ id: name, seq: 1001 }); save(); return 1001;
    },
  };
}

// ---------- MongoDB rejimi ----------
async function createMongoDb(uri) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'vector');

  await db.collection('users').createIndex({ phone: 1 }, { unique: true });
  await db.collection('users').createIndex({ id: 1 }, { unique: true });
  await db.collection('payments').createIndex({ id: 1 }, { unique: true });
  await db.collection('notifications').createIndex({ createdAt: -1 });

  const col = (name) => {
    const c = db.collection(name);
    return {
      async findOne(q) { return strip(await c.findOne(q)); },
      async find(q, opts = {}) {
        let cur = c.find(q);
        if (opts.sort) cur = cur.sort(opts.sort);
        if (opts.skip) cur = cur.skip(opts.skip);
        if (opts.limit) cur = cur.limit(opts.limit);
        return (await cur.toArray()).map(strip);
      },
      async insertOne(doc) { await c.insertOne({ ...doc }); return doc; },
      async updateOne(q, set) { const r = await c.updateOne(q, { $set: set }); return r.matchedCount > 0; },
      async count(q) { return c.countDocuments(q); },
    };
  };

  return {
    mode: 'mongo',
    col,
    async nextSeq(name) {
      const r = await db.collection('counters').findOneAndUpdate(
        { id: name },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      const doc = r && r.value !== undefined ? r.value : r;
      return 1000 + doc.seq;
    },
  };
}

async function connect() {
  if (process.env.MONGODB_URI) {
    const db = await createMongoDb(process.env.MONGODB_URI);
    console.log('🗄️  MongoDB ulandi');
    return db;
  }
  console.warn("⚠️  MONGODB_URI yo'q — ma'lumotlar vaqtinchalik faylda saqlanadi (Render'da qayta ishga tushganda o'chib ketadi!)");
  return createFileDb();
}

module.exports = { connect };
