// Serves the static export (`out/`) the way Firebase Hosting does:
// trailingSlash URLs → <dir>/index.html, 404.html for unknown paths.
//
//   node e2e/static-server.mjs [dir] [port]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(process.argv[2] || "out");
const port = Number(process.argv[3] || process.env.STATIC_PORT || 3100);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const file = path.join(root, clean);
  if (!file.startsWith(root)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  const index = path.join(file, "index.html");
  if (fs.existsSync(index)) return index;
  return null;
}

http
  .createServer((req, res) => {
    const urlPath = req.url || "/";
    // /dashboard → /dashboard/ (trailingSlash: true)
    if (!path.extname(urlPath.split("?")[0]) && !urlPath.split("?")[0].endsWith("/")) {
      const [p, q] = urlPath.split("?");
      res.writeHead(308, { Location: p + "/" + (q ? "?" + q : "") });
      return res.end();
    }
    const file = resolveFile(urlPath);
    if (!file) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      return fs.createReadStream(path.join(root, "404.html")).pipe(res);
    }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    // Compress text like Firebase Hosting does, so Lighthouse runs see real sizes.
    if (/text|javascript|json|svg|manifest/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      res.writeHead(200, { "Content-Type": type, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      return fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`[static-server] ${root} on http://localhost:${port}`));
