const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
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

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  const method = req.method;

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
  // /menu  → ruta limpia para QR e Instagram
  // /pedidos y /pedidos.html → compatibilidad
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

  // ── ADMIN: PANEL (protegido) ──
  if (urlPath === '/admin' || urlPath === '/admin/') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { 'Location': '/admin/login' });
      res.end();
      return;
    }
    serveFile(path.join(REAL_DIR, 'caja.html'), res);
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

  // ── BLOQUEAR acceso directo a archivos admin por nombre ──
  const safeName = path.basename(urlPath);
  if (safeName === 'caja.html' || safeName === 'cocina.html') {
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

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('');
  console.log('  ================================================');
  console.log('   🍔  CLICKS BURGER  —  Sistema de Comandera');
  console.log('  ================================================');
  console.log(`   Servidor corriendo en ${url}`);
  console.log('');
  console.log('   Panel Admin:  ' + url + '/admin');
  console.log('   Pedidos:      ' + url + '/pedidos.html');
  console.log('');
  console.log('   Usuario admin:    admin');
  console.log('   Contraseña admin: demo1234');
  console.log('');
  console.log('   ⚠  No cierres esta ventana mientras uses el sistema.');
  console.log('  ================================================');
  console.log('');
  exec(`start "" "${url}/admin"`);
});
