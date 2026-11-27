// Stand-in for Supabase's data API, for the end-to-end test only.
// Like Supabase, it checks the anon key, switches to the `anon` Postgres role, and calls the real
// recap_ingest(), recap_screenshot() and recap_frames() SQL functions, so the database's own permission rules are what's being exercised.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
// Connection comes from the usual PG* environment variables (PGHOST, PGUSER, PGDATABASE, ...).
const pool = new Pool();
const ANON = 'e2e-anon-key';
const DIST = path.join(__dirname, '..', 'dist');
const log = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log)); }
  const rpc = req.method === 'POST' && /^\/rest\/v1\/rpc\/(recap_ingest|recap_screenshot|recap_frames)\b/.exec(req.url);
  if (rpc) {
    const fn = rpc[1];
    let body = '';
    for await (const c of req) body += c;
    if (req.headers.apikey !== ANON) { log.push({ status: 401 }); res.writeHead(401, cors); return res.end('{"message":"bad key"}'); }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      const { payload } = JSON.parse(body);
      const r = await client.query(`select public.${fn}($1::jsonb) as n`, [JSON.stringify(payload)]);
      await client.query('commit');
      log.push(fn === 'recap_ingest'
        ? { status: 200, events: r.rows[0].n, session: payload.session.id }
        : fn === 'recap_frames'
          ? { status: 200, frames: r.rows[0].n }
          : { status: 200, screenshot: payload.screen, bytes: payload.image.length });
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(String(r.rows[0].n));
    } catch (e) {
      await client.query('rollback').catch(() => {});
      log.push({ status: 400, error: e.message });
      res.writeHead(400, cors); res.end(JSON.stringify({ message: e.message }));
    } finally { client.release(); }
    return;
  }
  // static app
  let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Build the app first: npm run export:web'); }
  const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.PORT || 8099), () => console.log('listening 8099'));
