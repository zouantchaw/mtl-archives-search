// Loopback-only synthetic QA actor. Not a Worker entry point or deploy artifact.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd(),
  cache = process.argv[2],
  inspectionCache = process.argv[3];
if (!cache || !inspectionCache)
  throw Error("Pass the verified local blob cache path.");
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "mtl-reviewer-qa-"));
await build({
  entryPoints: ["src/index.ts"],
  outfile: path.join(temp, "worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const { handleAuthenticated, default: worker } = await import(
  pathToFileURL(path.join(temp, "worker.mjs")).href
);
const db = new DatabaseSync(path.join(temp, "synthetic-qa.sqlite"));
db.exec(fs.readFileSync("migrations/0001.sql", "utf8"));
db.exec(fs.readFileSync("migrations/0002_assistance.sql", "utf8"));
db.exec(fs.readFileSync("migrations/0003_external_guidance.sql", "utf8"));
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
      async run() {
        return { success: true, meta: db.prepare(sql).run(...this.values) };
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
const artifacts = new Map();
const helpBucket = {
  async get(key) {
    const saved = artifacts.get(key);
    if (saved)
      return {
        size: saved.bytes.length,
        customMetadata: saved.options?.customMetadata,
        arrayBuffer: async () =>
          saved.bytes.buffer.slice(
            saved.bytes.byteOffset,
            saved.bytes.byteOffset + saved.bytes.byteLength,
          ),
      };
    const m = key.match(/^inspection\/v1\/([a-f0-9]{64})\.jpg$/);
    if (!m) return null;
    try {
      const b = await fsp.readFile(path.join(inspectionCache, m[1]));
      return {
        size: b.length,
        arrayBuffer: async () =>
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      };
    } catch {
      return null;
    }
  },
  async put(key, data, options) {
    artifacts.set(key, { bytes: Buffer.from(data), options });
  },
};
let modelFailure = false;
const images = {
  input(stream) {
    const transforms = [];
    const builder = {
      transform(x) {
        transforms.push(x);
        return builder;
      },
      async output(options) {
        const bytes = await new Response(stream).arrayBuffer();
        const result = spawnSync(
          path.resolve(root, "../../.venv-bulk/bin/python"),
          [
            "-c",
            `import sys,io,json
from PIL import Image
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
for op in json.loads(sys.argv[1]):
 if 'trim' in op:
  r=op['trim'];im=im.crop((r['left'],r['top'],r['left']+r['width'],r['top']+r['height']))
 if op.get('rotate'): im=im.rotate(-op['rotate'],expand=True)
 if 'width' in op: im.thumbnail((op['width'],op['height']),Image.Resampling.LANCZOS)
b=io.BytesIO();im.save(b,format='JPEG',quality=92);sys.stdout.buffer.write(b.getvalue())`,
            JSON.stringify(transforms),
          ],
          { input: Buffer.from(bytes), maxBuffer: 20 * 1024 * 1024 },
        );
        if (result.status)
          throw Error("Synthetic QA image render failed: " + result.stderr);
        return {
          response: () =>
            new Response(result.stdout, {
              headers: { "Content-Type": "image/jpeg" },
            }),
        };
      },
    };
    return builder;
  },
};
const env = {
  REVIEW_DB: database,
  SOURCES: bucket,
  DERIVED: bucket,
  HELP_ARTIFACTS: helpBucket,
  IMAGES: images,
  AI_GATEWAY_ID: "synthetic-qa-only",
  AI: {
    async run() {
      await new Promise((r) => setTimeout(r, 1200));
      if (modelFailure) {
        modelFailure = false;
        throw Error("Simulated model outage");
      }
      return {
        answer:
          "SYNTHETIC QA suggestion — Numeric marks may be visible in this area. Verify them against the pixels; this is not a real model response.",
        metrics: { input_tokens: 20, output_tokens: 30 },
      };
    },
  },
  HELP_QUEUE: {
    async send(body) {
      setTimeout(
        () =>
          worker
            .queue({ messages: [{ body, ack() {}, retry() {} }] }, env)
            .catch(console.error),
        10,
      );
    },
  },
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
    if (req.url === "/__qa/model-failure" && req.method === "POST") {
      modelFailure = true;
      res.writeHead(200);
      res.end("Synthetic next-model failure enabled");
      return;
    }
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
