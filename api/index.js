import { manifest } from '../lib/manifest.js';
import { getCtArchive, getCtMeta, getCtStream } from '../lib/ct.js';
import { getPrimaArchive, getPrimaMeta, getPrimaStream } from '../lib/prima.js';
import { getNovaArchive, getNovaMeta, getNovaStream } from '../lib/nova.js';

export default async function handler(req, res) {
  // CORS hlavičky pro Nuvio / Stremio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');

  const { url } = req;

  // 1. Manifest
  if (url === '/manifest.json' || url === '/') {
    return res.status(200).json(manifest);
  }

  // 2. Catalog handler (/catalog/series/cz_tv_archive/genre=...json)
  if (url.startsWith('/catalog/')) {
    const parts = url.split('/');
    const extraParams = parts[4] ? decodeURIComponent(parts[4]).replace('.json', '') : '';

    let genre = 'Vše';
    let search = '';

    if (extraParams.includes('genre=')) {
      genre = extraParams.split('genre=')[1].split('&')[0];
    }
    if (extraParams.includes('search=')) {
      search = extraParams.split('search=')[1].split('&')[0];
    }

    let metas = [];

    if (genre === 'Česká Televize') {
      metas = await getCtArchive(search);
    } else if (genre === 'iPrima') {
      metas = await getPrimaArchive(search);
    } else if (genre === 'Nova') {
      metas = await getNovaArchive(search);
    } else {
      const [ct, prima, nova] = await Promise.all([
        getCtArchive(search),
        getPrimaArchive(search),
        getNovaArchive(search)
      ]);
      metas = [...ct, ...prima, ...nova];
    }

    return res.status(200).json({ metas });
  }

  // 3. Meta handler (/meta/series/ct:123.json)
  if (url.startsWith('/meta/')) {
    const idWithJson = url.split('/')[3] || '';
    const fullId = decodeURIComponent(idWithJson).replace('.json', '');
    const [provider, realId] = fullId.split(':');

    let meta = null;
    if (provider === 'ct') meta = await getCtMeta(realId);
    if (provider === 'prima') meta = await getPrimaMeta(realId);
    if (provider === 'nova') meta = await getNovaMeta(realId);

    return res.status(200).json({ meta });
  }

  // 4. Stream handler (/stream/series/ct:456.json)
  if (url.startsWith('/stream/')) {
    const idWithJson = url.split('/')[3] || '';
    const fullId = decodeURIComponent(idWithJson).replace('.json', '');
    const [provider, realId] = fullId.split(':');

    let streams = [];
    if (provider === 'ct') streams = await getCtStream(realId);
    if (provider === 'prima') streams = await getPrimaStream(realId);
    if (provider === 'nova') streams = await getNovaStream(realId);

    return res.status(200).json({ streams });
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
