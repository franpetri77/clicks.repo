const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3131;

// ── DIRECTORIO RAÍZ ──
// En desarrollo (__dirname normal) o dentro del .exe (process.execPath)
// Siempre intentamos leer desde la carpeta real junto al ejecutable primero
const REAL_DIR = process.pkg
  ? path.dirname(process.execPath)   // carpeta donde vive el .exe
  : __dirname;                        // carpeta del script en desarrollo

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

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // ── IMÁGENES ──
  if (urlPath.startsWith('/img/')) {
    const imgName = path.basename(urlPath);
    // Solo permitir extensiones de imagen
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(imgName)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const imgPath = path.join(REAL_DIR, 'img', imgName);
    serveFile(imgPath, res);
    return;
  }

  // ── HTML ──
  const safeName = path.basename(urlPath);
  const allowed  = ['index.html', 'pedidos.html', 'cocina.html'];
  if (!allowed.includes(safeName)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const filePath = path.join(REAL_DIR, safeName);
  serveFile(filePath, res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  El puerto ${PORT} ya esta en uso.`);
    console.error('    Cerá esta ventana y volvé a abrir Clicks Burger.\n');
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
  console.log('   Abriendo el navegador...');
  console.log('');
  console.log('   ⚠  No cierres esta ventana mientras uses el sistema.');
  console.log('      Cerrala para apagar el servidor.');
  console.log('  ================================================');
  console.log('');
  exec(`start "" "${url}"`);
});
