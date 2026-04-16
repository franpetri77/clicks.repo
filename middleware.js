// middleware.js — Vercel Edge Middleware
// Protege todas las rutas /admin/* (excepto /admin/login).
// Usa Web Crypto API (disponible en Edge Runtime) para verificar el token HMAC.
// IMPORTANTE: este archivo usa ES module syntax (export default) requerido por Vercel Edge.

const SECRET = process.env.SESSION_SECRET || 'clicks-burger-secret-changeme';

// Convierte base64url a Uint8Array
function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function verifyToken(token) {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 1) return false;

    const payload = token.slice(0, dot);
    const sig     = token.slice(dot + 1);

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      fromB64url(sig),
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  // Solo intercepta rutas /admin, salvo la página de login en sí
  if (!pathname.startsWith('/admin') || pathname === '/admin/login') {
    return; // pasa sin modificar
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const match    = cookieHeader.match(/cb_session=([^;]+)/);
  const rawToken = match ? decodeURIComponent(match[1]) : null;

  if (!rawToken || !(await verifyToken(rawToken))) {
    return Response.redirect(new URL('/admin/login', request.url));
  }

  // Token válido — continúa normalmente
}

export const config = {
  matcher: ['/admin/:path*']
};
