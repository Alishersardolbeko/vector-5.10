// courses.js — kurslar, darslar, video (R2) va maktablar.
// Obuna tarifiga qarab darslarni ochadi; video havolasi faqat ruxsati borlarga beriladi.

const crypto = require('crypto');
const r2 = require('./r2');
const geo = require('./geo');

const TIER_RANK = { start: 1, pro: 2, vip: 3 };
const uid = () => crypto.randomUUID();
const now = () => Date.now();
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

function hasActivePlan(u) { return Boolean(u && u.plan && u.planExpiresAt > now() && !u.blocked); }
function canWatch(user, course, lesson) {
  if (lesson.free) return true;
  if (!hasActivePlan(user)) return false;
  return (TIER_RANK[user.plan] || 0) >= (TIER_RANK[course.minTier || 'start'] || 1);
}

function setup(app, { db, auth, optionalAuth, adminAuth, wrap, fail }) {
  const courses = () => db().col('courses');
  const lessons = () => db().col('lessons');
  const schools = () => db().col('schools');

  async function courseStats(courseId) {
    const list = await lessons().find({ courseId, published: true });
    return { lessonCount: list.length, duration: list.reduce((s, l) => s + (l.duration || 0), 0), freeCount: list.filter((l) => l.free).length };
  }
  function publicCourse(c, stats, user) {
    return {
      id: c.id, title: c.title, description: c.description, cover: c.cover || '', level: c.level || '',
      minTier: c.minTier || 'start', order: c.order || 0, ...stats,
      unlocked: hasActivePlan(user) && (TIER_RANK[user.plan] || 0) >= (TIER_RANK[c.minTier || 'start'] || 1),
    };
  }

  // ---------- Geo / maktablar ----------
  app.get('/api/geo', (req, res) => res.json({ regions: geo.REGIONS, grades: geo.GRADES }));

  app.get('/api/geo/schools', wrap(async (req, res) => {
    const district = clean(req.query.district, 80);
    const region = clean(req.query.region, 40);
    if (!geo.validDistrict(region, district)) return res.json({ schools: [] });
    const list = await schools().find({ region, district });
    res.json({ schools: sortSchools(list.map((s) => s.name)) });
  }));

  // ---------- Foydalanuvchi uchun kurslar ----------
  app.get('/api/courses', wrap(optionalAuth), wrap(async (req, res) => {
    const list = await courses().find({ published: true }, { sort: { order: 1 } });
    const out = [];
    for (const c of list) out.push(publicCourse(c, await courseStats(c.id), req.user));
    res.json({ courses: out, hasPlan: hasActivePlan(req.user) });
  }));

  app.get('/api/courses/:id', wrap(optionalAuth), wrap(async (req, res) => {
    const c = await courses().findOne({ id: req.params.id, published: true });
    if (!c) return fail(res, 404, 'Kurs topilmadi');
    const list = await lessons().find({ courseId: c.id, published: true }, { sort: { order: 1 } });
    res.json({
      course: publicCourse(c, await courseStats(c.id), req.user),
      lessons: list.map((l) => ({
        id: l.id, title: l.title, description: l.description || '', section: l.section || '',
        duration: l.duration || 0, free: Boolean(l.free), hasVideo: Boolean(l.videoKey),
        locked: !canWatch(req.user, c, l),
      })),
    });
  }));

  app.get('/api/lessons/:id/play', wrap(optionalAuth), wrap(async (req, res) => {
    const l = await lessons().findOne({ id: req.params.id, published: true });
    if (!l) return fail(res, 404, 'Dars topilmadi');
    const c = await courses().findOne({ id: l.courseId, published: true });
    if (!c) return fail(res, 404, 'Kurs topilmadi');
    if (!canWatch(req.user, c, l)) {
      return res.status(403).json({ error: req.user ? 'Bu dars uchun obuna kerak' : 'Avval tizimga kiring', locked: true, needLogin: !req.user });
    }
    if (!l.videoKey) return fail(res, 404, "Bu darsga hali video yuklanmagan");
    if (!r2.enabled) return fail(res, 503, 'Video ombori sozlanmagan');
    res.json({ url: r2.playUrl(l.videoKey), expiresIn: 3 * 3600 });
  }));

  // ---------- Admin: kurslar ----------
  app.get('/api/admin/courses', adminAuth, wrap(async (req, res) => {
    const list = await courses().find({}, { sort: { order: 1 } });
    const all = await lessons().find({});
    res.json({
      r2: r2.enabled,
      courses: list.map((c) => {
        const ls = all.filter((l) => l.courseId === c.id);
        return { ...c, lessonCount: ls.length, videoCount: ls.filter((l) => l.videoKey).length, size: ls.reduce((s, l) => s + (l.videoSize || 0), 0) };
      }),
    });
  }));

  function readCourse(b) {
    const c = {
      title: clean(b.title, 120), description: clean(b.description, 2000), cover: clean(b.cover, 500),
      level: clean(b.level, 40), minTier: TIER_RANK[b.minTier] ? b.minTier : 'start', published: Boolean(b.published),
    };
    if (b.order !== undefined) c.order = Number(b.order) || 0;
    return c;
  }

  app.post('/api/admin/courses', adminAuth, wrap(async (req, res) => {
    const c = readCourse(req.body);
    if (c.title.length < 2) return fail(res, 400, 'Kurs nomini kiriting');
    const count = await courses().count({});
    const doc = { id: uid(), ...c, order: c.order ?? count + 1, createdAt: now() };
    await courses().insertOne(doc);
    res.json({ course: doc });
  }));

  app.post('/api/admin/courses/:id', adminAuth, wrap(async (req, res) => {
    const c = readCourse(req.body);
    if (c.title.length < 2) return fail(res, 400, 'Kurs nomini kiriting');
    if (!(await courses().updateOne({ id: req.params.id }, { ...c, updatedAt: now() }))) return fail(res, 404, 'Kurs topilmadi');
    res.json({ ok: true });
  }));

  app.delete('/api/admin/courses/:id', adminAuth, wrap(async (req, res) => {
    const ls = await lessons().find({ courseId: req.params.id });
    for (const l of ls) await r2.remove(l.videoKey);
    await lessons().deleteMany({ courseId: req.params.id });
    if (!(await courses().deleteOne({ id: req.params.id }))) return fail(res, 404, 'Kurs topilmadi');
    res.json({ ok: true, deletedLessons: ls.length });
  }));

  // ---------- Admin: darslar ----------
  app.get('/api/admin/courses/:id/lessons', adminAuth, wrap(async (req, res) => {
    const c = await courses().findOne({ id: req.params.id });
    if (!c) return fail(res, 404, 'Kurs topilmadi');
    res.json({ course: c, lessons: await lessons().find({ courseId: c.id }, { sort: { order: 1 } }), r2: r2.enabled });
  }));

  function readLesson(b) {
    return {
      title: clean(b.title, 160), description: clean(b.description, 3000), section: clean(b.section, 80),
      free: Boolean(b.free), published: b.published === undefined ? true : Boolean(b.published),
      duration: Math.max(0, Math.round(Number(b.duration) || 0)),
    };
  }

  app.post('/api/admin/courses/:id/lessons', adminAuth, wrap(async (req, res) => {
    const c = await courses().findOne({ id: req.params.id });
    if (!c) return fail(res, 404, 'Kurs topilmadi');
    const l = readLesson(req.body);
    if (l.title.length < 2) return fail(res, 400, 'Dars nomini kiriting');
    const count = await lessons().count({ courseId: c.id });
    const doc = { id: uid(), courseId: c.id, ...l, order: count + 1, videoKey: null, videoSize: 0, createdAt: now() };
    await lessons().insertOne(doc);
    res.json({ lesson: doc });
  }));

  app.post('/api/admin/lessons/:id', adminAuth, wrap(async (req, res) => {
    const l = readLesson(req.body);
    if (l.title.length < 2) return fail(res, 400, 'Dars nomini kiriting');
    if (!(await lessons().updateOne({ id: req.params.id }, { ...l, updatedAt: now() }))) return fail(res, 404, 'Dars topilmadi');
    res.json({ ok: true });
  }));

  app.delete('/api/admin/lessons/:id', adminAuth, wrap(async (req, res) => {
    const l = await lessons().findOne({ id: req.params.id });
    if (!l) return fail(res, 404, 'Dars topilmadi');
    await r2.remove(l.videoKey);
    await lessons().deleteOne({ id: l.id });
    res.json({ ok: true });
  }));

  app.post('/api/admin/lessons/reorder', adminAuth, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500) : [];
    for (let i = 0; i < ids.length; i++) await lessons().updateOne({ id: String(ids[i]) }, { order: i + 1 });
    res.json({ ok: true });
  }));

  app.post('/api/admin/courses-reorder', adminAuth, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 200) : [];
    for (let i = 0; i < ids.length; i++) await courses().updateOne({ id: String(ids[i]) }, { order: i + 1 });
    res.json({ ok: true });
  }));

  // Video yuklash: 1) ruxsatnoma olish  2) brauzer to'g'ridan-to'g'ri R2'ga yuklaydi  3) tasdiqlash
  app.post('/api/admin/lessons/:id/upload-url', adminAuth, wrap(async (req, res) => {
    if (!r2.enabled) return fail(res, 503, "Cloudflare R2 sozlanmagan (Render → Environment)");
    const l = await lessons().findOne({ id: req.params.id });
    if (!l) return fail(res, 404, 'Dars topilmadi');
    const ext = (String(req.body.filename || '').match(/\.(mp4|m4v|mov|webm|mkv)$/i) || ['', 'mp4'])[1].toLowerCase();
    const key = `courses/${l.courseId}/${l.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    res.json({ uploadUrl: r2.uploadUrl(key), key });
  }));

  app.post('/api/admin/lessons/:id/video', adminAuth, wrap(async (req, res) => {
    const l = await lessons().findOne({ id: req.params.id });
    if (!l) return fail(res, 404, 'Dars topilmadi');
    const key = String(req.body.key || '');
    if (!key.startsWith(`courses/${l.courseId}/${l.id}-`)) return fail(res, 400, "Noto'g'ri video kaliti");
    if (!(await r2.exists(key))) return fail(res, 400, "Video R2'da topilmadi — yuklash tugamagan bo'lishi mumkin");
    if (l.videoKey && l.videoKey !== key) await r2.remove(l.videoKey);
    const set = { videoKey: key, videoSize: Math.max(0, Number(req.body.size) || 0), videoName: clean(req.body.name, 200), updatedAt: now() };
    if (Number(req.body.duration) > 0) set.duration = Math.round(Number(req.body.duration));
    await lessons().updateOne({ id: l.id }, set);
    res.json({ ok: true });
  }));

  app.delete('/api/admin/lessons/:id/video', adminAuth, wrap(async (req, res) => {
    const l = await lessons().findOne({ id: req.params.id });
    if (!l) return fail(res, 404, 'Dars topilmadi');
    await r2.remove(l.videoKey);
    await lessons().updateOne({ id: l.id }, { videoKey: null, videoSize: 0, videoName: '' });
    res.json({ ok: true });
  }));

  app.get('/api/admin/lessons/:id/preview', adminAuth, wrap(async (req, res) => {
    const l = await lessons().findOne({ id: req.params.id });
    if (!l || !l.videoKey) return fail(res, 404, 'Video yo\'q');
    if (!r2.enabled) return fail(res, 503, 'R2 sozlanmagan');
    res.json({ url: r2.playUrl(l.videoKey) });
  }));

  // ---------- Admin: maktablar ----------
  app.get('/api/admin/schools', adminAuth, wrap(async (req, res) => {
    const region = clean(req.query.region, 40), district = clean(req.query.district, 80);
    if (!geo.validDistrict(region, district)) return res.json({ schools: [] });
    const list = await schools().find({ region, district });
    res.json({ schools: sortSchools(list.map((s) => s.name)) });
  }));

  // "1-45, 47, Prezident maktabi" ko'rinishidagi matnni ro'yxatga aylantiradi
  app.post('/api/admin/schools', adminAuth, wrap(async (req, res) => {
    const region = clean(req.body.region, 40), district = clean(req.body.district, 80);
    if (!geo.validDistrict(region, district)) return fail(res, 400, 'Viloyat va tumanni tanlang');
    const names = parseSchools(req.body.text);
    if (!names.length) return fail(res, 400, 'Maktablarni kiriting');
    const existing = new Set((await schools().find({ region, district })).map((s) => s.name));
    let added = 0;
    for (const name of names) {
      if (existing.has(name)) continue;
      await schools().insertOne({ id: uid(), region, district, name, createdAt: now() });
      existing.add(name); added++;
    }
    res.json({ ok: true, added });
  }));

  app.post('/api/admin/schools/delete', adminAuth, wrap(async (req, res) => {
    const region = clean(req.body.region, 40), district = clean(req.body.district, 80);
    const name = clean(req.body.name, 120);
    if (req.body.all) await schools().deleteMany({ region, district });
    else await schools().deleteOne({ region, district, name });
    res.json({ ok: true });
  }));
}

function parseSchools(text) {
  const out = [];
  for (let part of String(text || '').split(/[,\n;]+/)) {
    part = part.trim();
    if (!part) continue;
    const m = part.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
    if (m) {
      const a = Math.min(+m[1], +m[2]), b = Math.min(Math.max(+m[1], +m[2]), a + 300);
      for (let i = a; i <= b; i++) out.push(`${i}-maktab`);
    } else if (/^\d{1,3}$/.test(part)) out.push(`${+part}-maktab`);
    else out.push(part.slice(0, 120));
  }
  return [...new Set(out)];
}
function sortSchools(names) {
  return names.sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });
}

module.exports = { setup, TIER_RANK, hasActivePlan };
