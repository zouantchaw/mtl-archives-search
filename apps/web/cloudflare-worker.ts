import { PUBLISHED_SNAPSHOT_PATH, SNAPSHOT_PROXY_TARGET } from './src/explorer/snapshot-proxy';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (["/kit_fr.pdf", "/kit_en.pdf"].includes(url.pathname)) {
      return fetch(`https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev${url.pathname}`);
    }
    if (url.pathname.startsWith('/snapshot/')) {
      const file = url.pathname.slice('/snapshot/'.length);
      if (!['manifest.json', 'points.json', 'ids.json', 'embeddings.bin', 'embeddings_2d.json', 'embeddings_ids.json', 'embeddings_512d.bin'].includes(file)) {
        return new Response('Unknown snapshot artifact', { status: 404 });
      }
      const headers = new Headers();
      for (const name of ['range', 'if-none-match', 'if-modified-since']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      return fetch(`${SNAPSHOT_PROXY_TARGET}${PUBLISHED_SNAPSHOT_PATH}/${file}`, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers,
      });
    }
    return env.ASSETS.fetch(request);
  },
};
