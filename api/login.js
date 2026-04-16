// api/login.js — Vercel Serverless Function
// Autentica al admin y setea una cookie firmada con HMAC-SHA256.
// Sin librerías externas: solo Node.js crypto built-in.

const crypto = require('crypto');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'demo1234';
const SECRET     = process.env.SESSION_SECRET || 'clicks-burger-secret-changeme';

// base64url sin padding
function toB64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Crea token: base64url(payload).base64url(hmac)
function createToken(user) {
  const payload = toB64url(Buffer.from(JSON.stringify({ u: user, t: Date.now() })));
  const sig     = toB64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c.toString(); });
    req.on('end', () => {
      const p = {};
      body.split('&').forEach(pair => {
        const [k, ...v] = pair.split('=');
        if (k) p[decodeURIComponent(k)] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
      });
      resolve(p);
    });
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const params = await parseBody(req);

  if (params.user === ADMIN_USER && params.pass === ADMIN_PASS) {
    const token = createToken(params.user);
    // Max-Age: 12 horas (un turno laboral)
    res.setHeader('Set-Cookie',
      `cb_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`
    );
    res.setHeader('Location', '/admin');
    res.status(302).end();
  } else {
    res.setHeader('Location', '/admin/login?error=1');
    res.status(302).end();
  }
};
