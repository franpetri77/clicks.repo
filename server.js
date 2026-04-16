const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const { exec } = require('child_process');

const PORT = 3131;

// ── DIRECTORIO RAÍZ ──
const REAL_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

// ── CREDENCIALES ADMIN ──
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'demo1234';

// ── SESIONES (en memoria) ──
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [key, ...vals] = part.trim().split('=');
    if (key) cookies[key.trim()] = vals.join('=');
  });
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['cb_session'];
  return !!(token && sessions.has(token));
}

// ── PEDIDOS EN TIEMPO REAL ──
const PEDIDOS_FILE = path.join(REAL_DIR, 'cb_cola.json');
let pedidosDB  = [];
let nextNum    = 1;
let sseClients = [];

function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

function cargarPedidosDB() {
  try {
    const raw  = fs.readFileSync(PEDIDOS_FILE, 'utf8');
    const data = JSON.parse(raw);
    pedidosDB = Array.isArray(data.pedidos) ? data.pedidos : [];
    nextNum   = typeof data.nextNum === 'number' ? data.nextNum : 1;
  } catch {
    pedidosDB = [];
    nextNum   = 1;
  }
}

function guardarPedidosDB() {
  try {
    fs.writeFileSync(PEDIDOS_FILE, JSON.stringify({ pedidos: pedidosDB, nextNum }));
  } catch (e) {
    console.error('Error guardando pedidos:', e.message);
  }
}

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(c => {
    try { c.write(msg); return true; }
    catch { return false; }
  });
}

function parseBodyJSON(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    const params = {};
    body.split('&').forEach(pair => {
      const [key, ...vals] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(vals.join('=').replace(/\+/g, ' '));
    });
    callback(params);
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];
  const method = req.method;

  // ── CORS headers para API (mismo origen, pero por si acaso) ──
  if (urlPath.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  }

  // ── API: SSE — stream de eventos en tiempo real ──
  if (urlPath === '/api/cola/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':ok\n\n');
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
    return;
  }

  // ── API: GET lista de pedidos ──
  if (urlPath === '/api/cola' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pedidos: pedidosDB, nextNum }));
    return;
  }

  // ── API: POST nuevo pedido (público — lo llama el cliente) ──
  if (urlPath === '/api/cola' && method === 'POST') {
    const data  = await parseBodyJSON(req);
    data.num    = nextNum++;
    data.estado = data.estado || 'nuevo';
    pedidosDB.push(data);
    guardarPedidosDB();
    broadcastSSE('nuevo_pedido', data);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, num: data.num }));
    return;
  }

  // ── API: PUT actualizar estado de un pedido (admin) ──
  // ── API: DELETE pedido individual (admin) ──
  const matchNum = urlPath.match(/^\/api\/cola\/(\d+)$/);
  if (matchNum) {
    if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
    const num = parseInt(matchNum[1], 10);

    if (method === 'PUT') {
      const update = await parseBodyJSON(req);
      const idx = pedidosDB.findIndex(p => p.num === num);
      if (idx >= 0) {
        pedidosDB[idx] = { ...pedidosDB[idx], ...update };
        guardarPedidosDB();
        broadcastSSE('pedido_actualizado', pedidosDB[idx]);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === 'DELETE') {
      pedidosDB = pedidosDB.filter(p => p.num !== num);
      guardarPedidosDB();
      broadcastSSE('pedido_eliminado', { num });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  // ── API: DELETE todos los pedidos (limpiar día) ──
  if (urlPath === '/api/cola' && method === 'DELETE') {
    if (!isAuthenticated(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
    pedidosDB = [];
    nextNum   = 1;
    guardarPedidosDB();
    broadcastSSE('pedidos_limpiados', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── IMÁGENES ──
  if (urlPath.startsWith('/img/')) {
    const imgName = path.basename(urlPath);
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(imgName)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    serveFile(path.join(REAL_DIR, 'img', imgName), res);
    return;
  }

  // ── HOME → redirige al admin ──
  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(302, { 'Location': '/admin' });
    res.end();
    return;
  }

  // ── CLIENTE: PEDIDOS (público, sin auth) ──
  if (urlPath === '/menu' || urlPath === '/pedidos' || urlPath === '/pedidos.html') {
    serveFile(path.join(REAL_DIR, 'pedidos.html'), res);
    return;
  }

  // ── ADMIN: LOGIN (GET) ──
  if (urlPath === '/admin/login') {
    if (method === 'GET') {
      serveFile(path.join(REAL_DIR, 'admin-login.html'), res);
      return;
    }
  }

  // ── ADMIN: POST LOGIN ──
  if (urlPath === '/api/login' && method === 'POST') {
    parseBody(req, (params) => {
      if (params.user === ADMIN_USER && params.pass === ADMIN_PASS) {
        const token = generateToken();
        sessions.set(token, { user: ADMIN_USER, createdAt: Date.now() });
        res.writeHead(302, {
          'Set-Cookie': `cb_session=${token}; HttpOnly; Path=/; SameSite=Strict`,
          'Location': '/admin'
        });
        res.end();
      } else {
        res.writeHead(302, { 'Location': '/admin/login?error=1' });
        res.end();
      }
    });
    return;
  }

  // ── ADMIN: POST LOGOUT ──
  if (urlPath === '/api/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['cb_session'];
    if (token) sessions.delete(token);
    res.writeHead(302, {
      'Set-Cookie': 'cb_session=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/admin/login'
    });
    res.end();
    return;
  }

  // ── ADMIN: SELECTOR PRINCIPAL (protegido) ──
  if (urlPath === '/admin' || urlPath === '/admin/') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { 'Location': '/admin/login' });
      res.end();
      return;
    }
    serveFile(path.join(REAL_DIR, 'index.html'), res);
    return;
  }

  // ── ADMIN: CAJA (protegida) ──
  if (urlPath === '/admin/caja') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { 'Location': '/admin/login' });
      res.end();
      return;
    }
    serveFile(path.join(REAL_DIR, 'caja.html'), res);
    return;
  }

  // ── TICKET DE COCINA (público) ──
  if (urlPath === '/ticket') {
    serveFile(path.join(REAL_DIR, 'ticket-cocina.html'), res);
    return;
  }

  // ── ADMIN: COCINA (protegida) ──
  if (urlPath === '/admin/cocina') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { 'Location': '/admin/login' });
      res.end();
      return;
    }
    serveFile(path.join(REAL_DIR, 'cocina.html'), res);
    return;
  }

  // ── BLOQUEAR acceso directo a archivos admin ──
  const safeName = path.basename(urlPath);
  if (['caja.html', 'cocina.html', 'index.html'].includes(safeName)) {
    res.writeHead(302, { 'Location': '/admin/login' });
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PORT} ya esta en uso.`);
    console.error('  Cerra esta ventana y volvé a abrir Clicks Burger.\n');
  } else {
    console.error('Error:', err.message);
  }
  process.exit(1);
});

cargarPedidosDB();

server.listen(PORT, '0.0.0.0', () => {
  const lanIP  = getLanIP();
  const local  = `http://127.0.0.1:${PORT}`;
  const lan    = lanIP ? `http://${lanIP}:${PORT}` : null;

  console.log('');
  console.log('  ================================================');
  console.log('   CLICKS BURGER  —  Sistema de Comandera');
  console.log('  ================================================');
  console.log(`   Admin (esta PC):  ${local}/admin`);
  if (lan) {
    console.log(`   Admin (red LAN):  ${lan}/admin`);
    console.log(`   Menu clientes:    ${lan}/menu  ← usar en QR`);
  }
  console.log('');
  console.log('   Caja:     /admin/caja');
  console.log('   Cocina:   /admin/cocina');
  console.log('');
  console.log('   Usuario admin:    admin');
  console.log('   Contrasena admin: demo1234');
  console.log('');
  console.log('   Los pedidos del cliente llegan en tiempo real.');
  console.log('   No cierres esta ventana mientras uses el sistema.');
  console.log('  ================================================');
  console.log('');
  exec(`start "" "${local}/admin"`);
});
