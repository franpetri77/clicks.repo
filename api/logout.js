// api/logout.js — Vercel Serverless Function
// Limpia la cookie de sesión y redirige al login.

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  res.setHeader('Set-Cookie',
    'cb_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict'
  );
  res.setHeader('Location', '/admin/login');
  res.status(302).end();
};
