/**
 * Minimal HTTPS reverse proxy — no external npm deps.
 * Streams responses (SSE-safe), forwards all headers, pipes request bodies.
 *
 * Usage: node scripts/https-proxy.mjs
 * Env:   HTTPS_PORT  (default 3443)
 *        TARGET_PORT (default 3000)
 *        TARGET_HOST (default 127.0.0.1)
 *        CERT_DIR    (default .certs relative to repo root)
 *        WSL_IP      (set by serve-https-proxy.sh for display only)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const HTTPS_PORT  = parseInt(process.env.HTTPS_PORT  ?? '3443', 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT ?? '3000', 10);
const TARGET_HOST = process.env.TARGET_HOST ?? '127.0.0.1';
const CERT_DIR    = process.env.CERT_DIR    ?? path.join(repoRoot, '.certs');
const WSL_IP      = process.env.WSL_IP      ?? '127.0.0.1';

const certPath = path.join(CERT_DIR, 'cert.pem');
const keyPath  = path.join(CERT_DIR, 'key.pem');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(`[https-proxy] cert/key not found in ${CERT_DIR}`);
  console.error('Run scripts/serve-https-proxy.sh to generate them first.');
  process.exit(1);
}

const tlsOptions = {
  cert: fs.readFileSync(certPath),
  key:  fs.readFileSync(keyPath),
};

const server = https.createServer(tlsOptions, (req, res) => {
  // Build upstream request options — forward all incoming headers as-is.
  const upstreamOptions = {
    hostname: TARGET_HOST,
    port:     TARGET_PORT,
    path:     req.url,
    method:   req.method,
    // Rewrite Host to the loopback target (keeps the loopback-guarded endpoints
    // working) but preserve the ORIGINAL host as x-forwarded-host so same-origin
    // checks (e.g. /connectors/voice/transcribe) can still recognize the UI.
    headers:  { ...req.headers, 'x-forwarded-host': req.headers.host, host: `${TARGET_HOST}:${TARGET_PORT}` },
  };

  const upstreamReq = http.request(upstreamOptions, (upstreamRes) => {
    // Forward status + all response headers unchanged.
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    // Pipe upstream → client without buffering (SSE / chunked streaming safe).
    upstreamRes.pipe(res, { end: true });
  });

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`Upstream error: ${err.message}`);
  });

  // Pipe incoming request body → upstream (handles POST/PUT/PATCH, etc.).
  req.pipe(upstreamReq, { end: true });
});

server.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log(`[https-proxy] Listening on https://0.0.0.0:${HTTPS_PORT}`);
  console.log(`[https-proxy] Proxying → http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`[https-proxy] Owner URL: https://${WSL_IP}:${HTTPS_PORT}`);
});

server.on('error', (err) => {
  console.error(`[https-proxy] Server error: ${err.message}`);
  process.exit(1);
});
