// TranslateOS ortak çeviri hafızası
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
//
// TV'ler açılışta hafızayı indirir (/v1/pack), yeni çevirilerini toplu gönderir (/v1/add).
// Sunucuya resim gitmez; sadece İngilizce cümle ve Türkçesi.
//
// Uç noktalar:
//   POST /v1/register              → { device, token }
//   GET  /v1/pack[?since=<ms>]     → { now, lines: { k: tr } }
//   POST /v1/add  { device, token, lines: [{ en, tr }] } → { added }
//   GET  /v1/stats                 → { lines, devices }
//   POST /v1/admin/purge { device } (Authorization: Bearer ADMIN_KEY) → TV'nin eklediklerini sil, TV'yi engelle

const MAX_BATCH = 50;          // tek istekte en fazla cümle
const DAILY_ADDS = 3000;       // TV başına günlük yeni cümle sınırı
const PACK_CACHE_SEC = 600;    // tam paket 10 dk önbellekte
const REG_PER_DAY = 20;        // aynı bağlantıdan günlük yeni TV kaydı

// TV servisiyle AYNI normalleştirme (service/index.js → normEn)
function normEn(t) { return String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
const CLEAN_TR = /^[\p{Script=Latin}\d\s.,!?'"“”‘’…\-–—:;()%&/*+#@]+$/u;

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extra },
});

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
const today = () => new Date().toISOString().slice(0, 10);

function validLine(en, tr) {
  en = String(en || '').trim(); tr = String(tr || '').trim();
  const k = normEn(en);
  if (!k || k.length < 2 || en.length > 300 || tr.length < 1 || tr.length > 400) return null;
  if (!CLEAN_TR.test(tr)) return null;            // bozuk karakter / başka alfabe
  if (normEn(tr) === k) return null;               // çevrilmemiş
  return { k, en, tr };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST' } });

    try {
      if (path === '/' ) return json({ name: 'TranslateOS', ok: true });

      if (path === '/v1/register' && req.method === 'POST') {
        // Aynı bağlantıdan günde en fazla REG_PER_DAY kayıt. IP saklanmaz: günlük tuzlu tek yönlü özet tutulur.
        const ip = req.headers.get('CF-Connecting-IP') || 'yok';
        const ipKey = (await hmac(env.SECRET, 'reg|' + today() + '|' + ip)).slice(0, 22);
        const row = await env.DB.prepare('INSERT INTO regs (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(ipKey, today()).first();
        if (row && row.n > REG_PER_DAY) return json({ error: 'çok fazla kayıt, yarın tekrar dene' }, 429);
        ctx.waitUntil(env.DB.prepare('DELETE FROM regs WHERE day < ?').bind(today()).run());
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO devices (id, created) VALUES (?, ?)').bind(id, Date.now()).run();
        return json({ device: id, token: await hmac(env.SECRET, id) });
      }

      if (path === '/v1/pack' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0) || 0;
        const now = Date.now();
        if (!since) {
          // Tam paket: aynı bölgedeki TV'ler için önbellekten (veritabanı okumasını azaltır)
          const cache = caches.default, ck = new Request(url.origin + '/v1/pack#full');
          const hit = await cache.match(ck);
          if (hit) return hit;
          const { results } = await env.DB.prepare('SELECT k, tr FROM lines').all();
          const lines = {}; for (const r of results) lines[r.k] = r.tr;
          const res = json({ now, lines }, 200, { 'Cache-Control': `public, max-age=${PACK_CACHE_SEC}` });
          ctx.waitUntil(cache.put(ck, res.clone()));
          return res;
        }
        const { results } = await env.DB.prepare('SELECT k, tr FROM lines WHERE updated > ?').bind(since - 60000).all();
        const lines = {}; for (const r of results) lines[r.k] = r.tr;
        return json({ now, lines });
      }

      if (path === '/v1/add' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const { device, token } = body;
        if (!device || !safeEqual(token, await hmac(env.SECRET, String(device)))) return json({ error: 'kimlik geçersiz' }, 401);
        const dev = await env.DB.prepare('SELECT day, adds, banned FROM devices WHERE id = ?').bind(device).first();
        if (!dev) return json({ error: 'kimlik geçersiz' }, 401);
        if (dev.banned) return json({ added: 0 });
        const items = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_BATCH).map((l) => validLine(l && l.en, l && l.tr)).filter(Boolean);
        const used = dev.day === today() ? dev.adds : 0;
        const room = Math.max(0, DAILY_ADDS - used);
        const take = items.slice(0, room);
        if (!take.length) return json({ added: 0, limit: room === 0 });
        const now = Date.now();
        // İlk gelen çeviri kalır; aynı cümle tekrar gelirse sadece "seen" artar.
        const stmts = take.map((l) => env.DB.prepare(
          'INSERT INTO lines (k, en, tr, device, created, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET seen = seen + 1'
        ).bind(l.k, l.en, l.tr, device, now, now));
        stmts.push(env.DB.prepare('UPDATE devices SET day = ?, adds = ? WHERE id = ?').bind(today(), used + take.length, device));
        await env.DB.batch(stmts);
        return json({ added: take.length });
      }

      if (path === '/v1/stats' && req.method === 'GET') {
        const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM lines').first();
        const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first();
        return json({ lines: a.n, devices: b.n });
      }

      if (path === '/v1/admin/purge' && req.method === 'POST') {
        const auth = req.headers.get('Authorization') || '';
        if (!env.ADMIN_KEY || !safeEqual(auth, 'Bearer ' + env.ADMIN_KEY)) return json({ error: 'yetkisiz' }, 401);
        const { device } = await req.json().catch(() => ({}));
        if (!device) return json({ error: 'device gerekli' }, 400);
        const r = await env.DB.prepare('DELETE FROM lines WHERE device = ?').bind(device).run();
        await env.DB.prepare('UPDATE devices SET banned = 1 WHERE id = ?').bind(device).run();
        return json({ deleted: r.meta.changes });
      }

      return json({ error: 'bulunamadı' }, 404);
    } catch (e) {
      return json({ error: 'sunucu hatası' }, 500);
    }
  },
};
