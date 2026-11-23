const path = require('node:path');
const { pathToFileURL } = require('node:url');

function resolveArchivePath(input, root) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'tingyu-ui:' || url.hostname !== 'archive' || url.port || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (/[\\\0]/.test(pathname) || pathname.split('/').includes('..')) return null;
    const relative = pathname === '/' || /^\/work(?:\/|$)/.test(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    const inside = path.relative(root, file);
    return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? file : null;
  } catch { return null; }
}

function installArchiveProtocol(protocol, electronNet, root) {
  protocol.handle('tingyu-ui', async request => {
    const file = resolveArchivePath(request.url, root);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const response = await electronNet.fetch(pathToFileURL(file).href, { headers: request.headers });
      if (path.extname(file) !== '.html') return response;
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; media-src 'self' data: blob:; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}
module.exports = { resolveArchivePath, installArchiveProtocol };
