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
//   POST /v1/gemini/<model>:<method>  (x-device, x-token)  → anahtarsız mod: Gemini isteğini sunucunun anahtarıyla iletir
//   POST /v1/admin/purge { device } (Authorization: Bearer ADMIN_KEY) → TV'nin eklediklerini sil, TV'yi engelle

const MAX_BATCH = 50;          // tek istekte en fazla cümle
const DAILY_ADDS = 3000;       // TV başına günlük yeni cümle sınırı
const PACK_CACHE_SEC = 600;    // tam paket 10 dk önbellekte
const REG_PER_DAY = 20;        // aynı bağlantıdan günlük yeni TV kaydı
// Anahtarsız mod sınırları (Cloudflare ortam değişkeniyle değiştirilebilir: DEVICE_DAILY, GLOBAL_DAILY)
const DEVICE_DAILY = 1500;     // TV başına günlük çeviri isteği
const GLOBAL_DAILY = 20000;    // herkes için toplam günlük çeviri isteği (fatura tavanı)
const MAX_BODY = 400000;       // istek boyutu (bayt)
// Ortak hafızaya giriş: aynı cümleyi bu kadar farklı TV aynı okumalı (güvenilir TV'ler tek başına yeter)
const MIN_CONFIRM = 2;

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
const minConfirm = (env) => Number(env.MIN_CONFIRM || MIN_CONFIRM);
// Ortak şekil hafızası: onaylı cümlelerin yazı şekilleri → [k, w, h, b]. TV aynı altyazıyı Gemini'ye sormadan tanır.
async function packFps(env, since) {
  const { results } = await env.DB.prepare(
    'SELECT f.k AS k, f.w AS w, f.h AS h, f.b AS b FROM fps f JOIN lines l ON l.k = f.k WHERE l.confirm >= ? AND f.created > ? LIMIT 30000'
  ).bind(minConfirm(env), since || 0).all();
  return results.map((r) => [r.k, r.w, r.h, r.b]);
}

// --- Anahtarsız mod: TV'nin Gemini isteğini sunucunun anahtarıyla iletir ---
async function geminiProxy(req, env, url, model, method) {
  if (!env.GEMINI_KEY) return json({ error: 'anahtarsız mod kapalı' }, 503);
  const device = req.headers.get('x-device') || '', token = req.headers.get('x-token') || '';
  if (!device || !safeEqual(token, await hmac(env.SECRET, device))) return json({ error: 'kimlik geçersiz' }, 401);
  if (model !== (env.GEMINI_MODEL || 'gemini-flash-lite-latest')) return json({ error: 'model desteklenmiyor' }, 400);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'istek çok büyük' }, 413);
  let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'geçersiz istek' }, 400); }
  // Sadece altyazı çevirisi biçimindeki istekler: 1 resim + 1 metin
  const parts = body && body.contents && body.contents.length === 1 && body.contents[0].parts;
  if (!Array.isArray(parts) || parts.length > 2 || parts.filter((p) => p.inline_data || p.inlineData).length !== 1 ||
      parts.some((p) => p.text && p.text.length > 3000)) return json({ error: 'geçersiz istek' }, 400);
  body.generationConfig = Object.assign({}, body.generationConfig || {}, { maxOutputTokens: 400, candidateCount: 1 });
  delete body.tools; delete body.systemInstruction; delete body.cachedContent;

  // Kota: önce toplam tavan, sonra TV başına
  const day = today();
  const g = await env.DB.prepare('INSERT INTO usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n').bind(day).first();
  if (g.n > Number(env.GLOBAL_DAILY || GLOBAL_DAILY)) return json({ error: 'quota', scope: 'global' }, 429);
  const d = await env.DB.prepare('UPDATE devices SET gday = ?, gcount = CASE WHEN gday = ? THEN gcount + 1 ELSE 1 END WHERE id = ? AND banned = 0 RETURNING gcount').bind(day, day, device).first();
  if (!d) return json({ error: 'kimlik geçersiz' }, 401);
  if (d.gcount > Number(env.DEVICE_DAILY || DEVICE_DAILY)) return json({ error: 'quota', scope: 'device' }, 429);

  const up = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':' + method + (method === 'streamGenerateContent' ? '?alt=sse' : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body: JSON.stringify(body),
  });
  return new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json' } });
}

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
          const { results } = await env.DB.prepare('SELECT k, tr FROM lines WHERE confirm >= ?').bind(minConfirm(env)).all();
          const lines = {}; for (const r of results) lines[r.k] = r.tr;
          const fps = await packFps(env, 0);
          const res = json({ now, lines, fps }, 200, { 'Cache-Control': `public, max-age=${PACK_CACHE_SEC}` });
          ctx.waitUntil(cache.put(ck, res.clone()));
          return res;
        }
        const { results } = await env.DB.prepare('SELECT k, tr FROM lines WHERE updated > ? AND confirm >= ?').bind(since - 60000, minConfirm(env)).all();
        const lines = {}; for (const r of results) lines[r.k] = r.tr;
        return json({ now, lines, fps: await packFps(env, since - 60000) });
      }

      if (path === '/v1/add' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const { device, token } = body;
        if (!device || !safeEqual(token, await hmac(env.SECRET, String(device)))) return json({ error: 'kimlik geçersiz' }, 401);
        const dev = await env.DB.prepare('SELECT day, adds, banned FROM devices WHERE id = ?').bind(device).first();
        if (!dev) return json({ error: 'kimlik geçersiz' }, 401);
        if (dev.banned) return json({ added: 0 });
        const items = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_BATCH).map((l) => {
          const v = validLine(l && l.en, l && l.tr); if (!v) return null;
          const fp = l.fp;   // yazının şekli: { w, h, b } (b: 1920 bitlik desen, base64)
          if (fp && Number.isInteger(fp.w) && Number.isInteger(fp.h) && fp.w > 0 && fp.w < 1000 && fp.h > 0 && fp.h < 200 &&
              typeof fp.b === 'string' && fp.b.length <= 400 && /^[A-Za-z0-9+/=]+$/.test(fp.b)) v.fp = fp;
          return v;
        }).filter(Boolean);
        const used = dev.day === today() ? dev.adds : 0;
        const room = Math.max(0, DAILY_ADDS - used);
        const take = items.slice(0, room);
        if (!take.length) return json({ added: 0, limit: room === 0 });
        const now = Date.now();
        // İlk gelen çeviri kalır. Aynı cümleyi BAŞKA bir TV de okursa onay artar; yeterli onayla herkese açılır.
        // Güvenilir TV'lerin (TRUSTED_DEVICES) eklediği cümle hemen onaylı sayılır.
        const trusted = String(env.TRUSTED_DEVICES || '').split(',').map((x) => x.trim()).includes(device);
        const first = trusted ? 99 : 1;
        const stmts = take.map((l) => env.DB.prepare(
          'INSERT INTO lines (k, en, tr, device, confirm, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(k) DO UPDATE SET seen = seen + 1, ' +
          'confirm = CASE WHEN lines.device != excluded.device THEN MAX(lines.confirm + 1, excluded.confirm) ELSE MAX(lines.confirm, excluded.confirm) END, ' +
          'updated = CASE WHEN lines.device != excluded.device OR excluded.confirm > lines.confirm THEN excluded.updated ELSE lines.updated END'
        ).bind(l.k, l.en, l.tr, device, first, now, now));
        for (const l of take) if (l.fp) stmts.push(env.DB.prepare(
          'INSERT OR IGNORE INTO fps (k, w, h, b, device, created) VALUES (?, ?, ?, ?, ?, ?)').bind(l.k, l.fp.w, l.fp.h, l.fp.b, device, now));
        stmts.push(env.DB.prepare('UPDATE devices SET day = ?, adds = ? WHERE id = ?').bind(today(), used + take.length, device));
        await env.DB.batch(stmts);
        return json({ added: take.length });
      }

      if (path === '/v1/stats' && req.method === 'GET') {
        const a = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(confirm >= ?) AS c FROM lines').bind(minConfirm(env)).first();
        const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first();
        const u = await env.DB.prepare('SELECT n FROM usage WHERE day = ?').bind(today()).first();
        return json({ lines: a.n, shared: a.c || 0, devices: b.n, translatedToday: u ? u.n : 0, keyless: !!env.GEMINI_KEY });
      }

      const gm = path.match(/^\/v1\/gemini\/([a-z0-9.\-]+):(streamGenerateContent|generateContent)$/);
      if (gm && req.method === 'POST') return geminiProxy(req, env, url, gm[1], gm[2]);

      if (path === '/v1/admin/purge' && req.method === 'POST') {
        const auth = req.headers.get('Authorization') || '';
        if (!env.ADMIN_KEY || !safeEqual(auth, 'Bearer ' + env.ADMIN_KEY)) return json({ error: 'yetkisiz' }, 401);
        const { device } = await req.json().catch(() => ({}));
        if (!device) return json({ error: 'device gerekli' }, 400);
        await env.DB.prepare('DELETE FROM fps WHERE device = ?').bind(device).run();
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
