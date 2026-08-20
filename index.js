import { unconfiguredManifest, configuredManifest } from '../lib/manifest.js';
import { discoverMovies, discoverSeries, getMovieMeta, getSeriesMeta } from '../lib/tmdb.js';
import { resolveApiKey } from '../lib/config.js';
import { configurePageHtml } from '../lib/configure.js';

function parseExtra(rawSegment) {
  const out = {};
  if (!rawSegment) return out;
  const clean = rawSegment.replace('.json', '');
  clean.split('&').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    if (k) out[k] = v;
  });
  return out;
}

// Cesty, které NEJSOU konfigurační base64 segment, ale přímo route.
// Používá se k rozpoznání, jestli první segment URL je "/CONFIG/manifest.json"
// (s konfigurací) nebo "/manifest.json" (bez konfigurace).
const KNOWN_FIRST_SEGMENTS = new Set(['manifest.json', 'catalog', 'meta', 'configure']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const { url } = req;
  const pathOnly = url.split('?')[0];
  const segments = pathOnly.split('/').filter(Boolean);

  // 1. Kořen a /configure -> instalační stránka s formulářem pro TMDB klíč
  if (segments.length === 0 || segments[0] === 'configure') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(configurePageHtml());
  }

  // 2. Rozpoznej, jestli první segment je konfigurace (base64) nebo přímo route
  let configSegment = null;
  let rest = segments;
  if (!KNOWN_FIRST_SEGMENTS.has(segments[0])) {
    configSegment = segments[0];
    rest = segments.slice(1);
  }

  const apiKey = resolveApiKey(configSegment);
  const routePath = '/' + rest.join('/');

  res.setHeader('Content-Type', 'application/json');

  // 3. Manifest
  if (routePath === '/manifest.json') {
    return res.status(200).json(apiKey ? configuredManifest() : unconfiguredManifest());
  }

  // Od téhle chvíle už jde o katalog/meta, kde je TMDB klíč potřeba
  if (!apiKey && (routePath.startsWith('/catalog/') || routePath.startsWith('/meta/'))) {
    return res.status(200).json({ metas: [], meta: {}, error: 'Chybí TMDB API klíč — nainstaluj doplněk znovu přes /configure.' });
  }

  // 4. Catalog handler: /catalog/{type}/{id}/{extra}.json nebo /catalog/{type}/{id}.json
  if (routePath.startsWith('/catalog/')) {
    const parts = rest; // [catalog, type, id(.json), extra.json?]
    const type = parts[1];
    const extra = parseExtra(parts[3]);
    const sort = extra.sort || 'Populární';
    const country = extra.country || 'CZ + SK';
    const search = extra.search || '';
    const skip = extra.skip ? Number(extra.skip) : 0;

    let metas = [];
    try {
      if (type === 'movie') {
        metas = await discoverMovies(apiKey, { sort, search, skip, country });
      } else if (type === 'series') {
        metas = await discoverSeries(apiKey, { sort, search, skip, country });
      }
    } catch (err) {
      console.error('Catalog Error:', err);
    }

    return res.status(200).json({ metas });
  }

  // 5. Meta handler: /meta/{type}/{id}.json
  if (routePath.startsWith('/meta/')) {
    const parts = rest;
    const type = parts[1];
    const id = decodeURIComponent(parts[2] || '').replace('.json', '');

    let meta = null;
    try {
      if (type === 'movie') meta = await getMovieMeta(apiKey, id);
      if (type === 'series') meta = await getSeriesMeta(apiKey, id);
    } catch (err) {
      console.error('Meta Error:', err);
    }

    return res.status(200).json({ meta: meta || {} });
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
