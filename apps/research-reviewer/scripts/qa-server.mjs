// Loopback-only synthetic QA actor. Not a Worker entry point or deploy artifact.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = process.cwd(),
  cache = process.argv[2];
if (!cache) throw Error("Pass the verified local blob cache path.");
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "mtl-reviewer-qa-"));
await build({
  entryPoints: ["src/index.ts"],
  outfile: path.join(temp, "worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const { handleAuthenticated } = await import(
  pathToFileURL(path.join(temp, "worker.mjs")).href
);
const db = new DatabaseSync(path.join(temp, "synthetic-qa.sqlite"));
db.exec(fs.readFileSync("migrations/0001.sql", "utf8"));
const database = {
  prepare(sql) {
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...this.values) ?? null;
      },
      async all() {
        return { results: db.prepare(sql).all(...this.values) };
      },
    };
  },
};
const bucket = {
  async get(key) {
    if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(key)) return null;
    const file = path.join(cache, key.split("/").at(-1));
    try {
      const stat = await fsp.stat(file);
      return {
        size: stat.size,
        body: Readable.toWeb(fs.createReadStream(file)),
        arrayBuffer: async () => {
          const data = await fsp.readFile(file);
          return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          );
        },
      };
    } catch {
      return null;
    }
  },
};
const env = {
  REVIEW_DB: database,
  SOURCES: bucket,
  DERIVED: bucket,
  ASSETS: {
    async fetch(req) {
      let name = new URL(req.url).pathname;
      if (name === "/") name = "/index.html";
      if (name.includes(".."))
        return new Response("Not found", { status: 404 });
      const file = path.join(root, "dist", name);
      try {
        const data = await fsp.readFile(file);
        const ext = path.extname(file);
        return new Response(data, {
          headers: {
            "Content-Type":
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".woff2": "font/woff2",
                ".woff": "font/woff",
              }[ext] || "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const data of req) chunks.push(data);
    const request = new Request("http://127.0.0.1:8796" + req.url, {
      method: req.method,
      headers: req.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    let out = await handleAuthenticated(request, env, {
      id: "synthetic-qa-actor",
      email: "synthetic-qa@example.invalid",
    });
    if (req.url === "/api/export") {
      const data = await out.json();
      data.reviewerType = "synthetic_qa_actor";
      out = Response.json(data, { headers: out.headers });
    }
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (out.body) Readable.fromWeb(out.body).pipe(res);
    else res.end();
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
server.listen(8796, "127.0.0.1", () =>
  console.log(
    "Synthetic QA only: http://127.0.0.1:8796 · no Cloudflare writes",
  ),
);
async function stop() {
  server.close();
  db.close();
  await fsp.rm(temp, { recursive: true, force: true });
  process.exit();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
