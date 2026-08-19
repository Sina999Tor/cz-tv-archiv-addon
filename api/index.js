import { manifest } from '../lib/manifest.js';
import { discoverMovies, discoverSeries, getMovieMetaByImdb, getSeriesMetaByImdb } from '../lib/tmdb.js';
import { getStreams } from '../lib/stream.js';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');

  const { url } = req;

  // 1. Manifest
  if (url === '/manifest.json' || url === '/') {
    return res.status(200).json(manifest);
  }

  // 2. Catalog handler: /catalog/{type}/{id}/{extra}.json nebo /catalog/{type}/{id}.json
  if (url.startsWith('/catalog/')) {
    const parts = url.split('/'); // ['', 'catalog', type, id(.json), extra.json?]
    const type = parts[2];
    const extra = parseExtra(parts[4]);
    const genre = extra.genre || 'Populární';
    const country = extra.country || 'CZ + SK';
    const search = extra.search || '';
    const skip = extra.skip ? Number(extra.skip) : 0;

    let metas = [];
    try {
      if (type === 'movie') {
        metas = await discoverMovies({ genre, search, skip, country });
      } else if (type === 'series') {
        metas = await discoverSeries({ genre, search, skip, country });
      }
    } catch (err) {
      console.error('Catalog Error:', err);
    }

    return res.status(200).json({ metas });
  }

  // 3. Meta handler: /meta/{type}/{id}.json
  if (url.startsWith('/meta/')) {
    const parts = url.split('/');
    const type = parts[2];
    const id = decodeURIComponent(parts[3] || '').replace('.json', '');

    let meta = null;
    try {
      if (type === 'movie') meta = await getMovieMetaByImdb(id);
      if (type === 'series') meta = await getSeriesMetaByImdb(id);
    } catch (err) {
      console.error('Meta Error:', err);
    }

    return res.status(200).json({ meta: meta || {} });
  }

  // 4. Stream handler: /stream/{type}/{id}.json  (id může být "tt123:1:2")
  if (url.startsWith('/stream/')) {
    const parts = url.split('/');
    const type = parts[2];
    const id = decodeURIComponent(parts[3] || '').replace('.json', '');

    const streams = await getStreams(type, id);
    return res.status(200).json({ streams });
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
