const http = require('http');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  // strip /v6/console/ prefix
  if (url.startsWith('/v6/console/')) {
    url = '/' + url.slice('/v6/console/'.length);
  } else if (url === '/v6/console') {
    url = '/';
  }

  let filePath = path.join(dist, url === '/' ? 'index.html' : url);

  // SPA fallback: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(dist, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

const port = parseInt(process.env.PORT, 10) || 19101;
server.listen(port, '127.0.0.1', () => {
  console.log('V6 Console serving at http://127.0.0.1:' + port + '/v6/console/');
});
