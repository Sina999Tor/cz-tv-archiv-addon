import fetch from 'node-fetch';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

// 1. KATALOG / VYHLEDÁVÁNÍ
export async function getNovaArchive(searchQuery = '') {
  try {
    const url = searchQuery
      ? `https://tn.nova.cz/api/v1/search?q=${encodeURIComponent(searchQuery)}`
      : 'https://tn.nova.cz/api/v1/shows';

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.items || [];

    return items.map(item => ({
      id: `nova:${item.id}`,
      type: 'series',
      name: item.name || item.title,
      poster: item.image || '',
      description: item.perex || item.description || 'Pořad TV Nova',
      genres: ['Nova']
    }));
  } catch (err) {
    console.error('Nova Catalog Error:', err);
    return [];
  }
}

// 2. DETAIL POŘADU & EPIZODY
export async function getNovaMeta(id) {
  try {
    const res = await fetch(`https://tn.nova.cz/api/v1/shows/${id}`, { headers: HEADERS });
    if (!res.ok) return null;

    const data = await res.json();
    const episodes = data.episodes || [];

    const videos = episodes.map((ep, idx) => ({
      id: `nova:${ep.id}`,
      title: ep.title || `Epizoda ${idx + 1}`,
      season: ep.season || 1,
      episode: ep.episode_number || idx + 1,
      thumbnail: ep.image || ''
    }));

    return {
      id: `nova:${id}`,
      type: 'series',
      name: data.name,
      poster: data.image || '',
      description: data.perex || '',
      genres: ['Nova'],
      videos: videos
    };
  } catch (err) {
    console.error('Nova Meta Error:', err);
    return null;
  }
}

// 3. STREAM (m3u8)
export async function getNovaStream(id) {
  try {
    const res = await fetch(`https://tn.nova.cz/api/v1/episodes/${id}/stream`, { headers: HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const streamUrl = data.src || data.hls;

    if (streamUrl) {
      return [{
        title: 'Nova Free HLS',
        url: streamUrl,
        type: 'hls'
      }];
    }
  } catch (err) {
    console.error('Nova Stream Error:', err);
  }
  return [];
}
