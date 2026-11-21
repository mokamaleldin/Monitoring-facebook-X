import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

export function serveStaticOut(outDir, port = 3000, host = "127.0.0.1") {
  const root = resolve(outDir);
  const server = createServer((req, res) => {
    const parsed = new URL(req.url || "/", `http://${host}:${port}`);
    let relPath = decodeURIComponent(parsed.pathname);
    if (relPath.includes("..")) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    let filePath = resolve(root, "." + relPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    } else if (!existsSync(filePath) && existsSync(filePath + ".html")) {
      filePath = filePath + ".html";
    } else if (!existsSync(filePath) && existsSync(join(filePath, "index.html"))) {
      filePath = join(filePath, "index.html");
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      const notFound = join(root, "404.html");
      if (existsSync(notFound)) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        createReadStream(notFound).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => resolveListen(server));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 3000);
  const outDir = resolve(process.cwd(), "out");
  await serveStaticOut(outDir, port);
  console.log(`Serving static export ${outDir} on http://127.0.0.1:${port}`);
}
