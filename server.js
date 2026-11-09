const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.CYCLOPS_PUBLISH_TOKEN;
const FEED = path.join(ROOT, 'articles.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let writeQueue = Promise.resolve();

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readArticles() {
  try {
    const data = JSON.parse(await fs.readFile(FEED, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function publish(req, res) {
  if (!TOKEN) return send(res, 503, { error: 'Publishing is disabled: set CYCLOPS_PUBLISH_TOKEN.' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Unauthorized' });

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) return send(res, 413, { error: 'Request body is too large.' });
  }

  let article;
  try { article = JSON.parse(body); } catch { return send(res, 400, { error: 'Request body must be valid JSON.' }); }
  if (!article || typeof article !== 'object' || Array.isArray(article) || !String(article.title || '').trim() || !String(article.article || article.text || article.content || '').trim()) {
    return send(res, 400, { error: 'Article must include a title and article text.' });
  }
  if (!/^https?:\/\//i.test(article.sourceUrl || article.link || '')) return send(res, 400, { error: 'Article must include an http(s) sourceUrl.' });

  const save = async () => {
    const articles = await readArticles();
    const url = article.sourceUrl || article.link;
    const normalized = { ...article, sourceUrl: url, publishedAt: article.publishedAt || article.isoDate || article.pubDate || new Date().toISOString() };
    const oldIndex = articles.findIndex(item => (item.sourceUrl || item.link) === url);
    if (oldIndex >= 0) articles[oldIndex] = { ...articles[oldIndex], ...normalized };
    else articles.unshift(normalized);
    const temporary = `${FEED}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, FEED);
    return send(res, oldIndex >= 0 ? 200 : 201, { ok: true, updated: oldIndex >= 0, count: articles.length });
  };
  try {
    const result = writeQueue.then(save, save);
    writeQueue = result.then(() => undefined, () => undefined);
    await result;
  } catch (error) {
    console.error('Could not save article:', error);
    return send(res, 500, { error: 'Could not save article feed.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/articles' && req.method === 'POST') return publish(req, res);
  if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

  let pathname;
  try { pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); }
  catch { return send(res, 400, { error: 'Invalid path' }); }
  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) && file !== FEED) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file === FEED ? 'no-store' : 'public, max-age=300' });
    return req.method === 'HEAD' ? res.end() : res.end(data);
  } catch (error) {
    return send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found' : 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Cyclops News listening on port ${PORT}`));
