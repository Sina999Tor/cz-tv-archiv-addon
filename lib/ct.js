import fetch from 'node-fetch';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest'
};

// 1. KATALOG / VYHLEDÁVÁNÍ
export async function getCtArchive(searchQuery = '') {
  try {
    const url = searchQuery
      ? `https://www.ceskatelevize.cz/ivysilani/ajax/vyhledavani/?dotaz=${encodeURIComponent(searchQuery)}`
      : 'https://www.ceskatelevize.cz/ivysilani/ajax/porady-a-z/';

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.items || data.porady || [];

    return items.map(item => ({
      id: `ct:${item.id || item.urlUrl}`,
      type: 'series',
      name: item.title || item.nazev,
      poster: item.image || item.foto || 'https://www.ceskatelevize.cz/specialy/design/logo-ct.png',
      description: item.synopsis || item.popis || 'Pořad České televize',
      genres: ['Česká Televize']
    }));
  } catch (err) {
    console.error('ČT Catalog Error:', err);
    return [];
  }
}

// 2. DETAIL POŘADU & SEZNAM EPIZOD
export async function getCtMeta(id) {
  try {
    const res = await fetch(`https://www.ceskatelevize.cz/ivysilani/ajax/porad-epizody/?id=${encodeURIComponent(id)}`, { headers: HEADERS });
    if (!res.ok) return null;

    const data = await res.json();
    const episodes = data.episodes || data.polozky || [];

    const videos = episodes.map((ep, index) => ({
      id: `ct:${ep.id}`,
      title: ep.title || `Epizoda ${index + 1}`,
      season: ep.season || 1,
      episode: ep.episodeNumber || index + 1,
      released: ep.date || new Date().toISOString().split('T')[0],
      thumbnail: ep.image || ep.foto || ''
    }));

    return {
      id: `ct:${id}`,
      type: 'series',
      name: data.title || 'Pořad ČT',
      poster: data.image || '',
      description: data.description || '',
      genres: ['Česká Televize'],
      videos: videos
    };
  } catch (err) {
    console.error('ČT Meta Error:', err);
    return null;
  }
}

// 3. STREAM (HLS .m3u8)
export async function getCtStream(id) {
  try {
    const res = await fetch('https://www.ceskatelevize.cz/ivysilani/ajax/get-client-playlist/', {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: `id=${encodeURIComponent(id)}`
    });

    if (!res.ok) return [];
    const data = await res.json();
    const streamUrl = data?.playlist?.[0]?.streamUrls?.main;

    if (streamUrl) {
      return [{
        title: 'iVysílání HLS (Auto)',
        url: streamUrl,
        type: 'hls'
      }];
    }
  } catch (err) {
    console.error('ČT Stream Error:', err);
  }
  return [];
}
