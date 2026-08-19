import fetch from 'node-fetch';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

// 1. KATALOG / VYHLEDÁVÁNÍ
export async function getPrimaArchive(searchQuery = '') {
  try {
    const endpoint = searchQuery
      ? `https://api.play.iprima.cz/v1/titles?q=${encodeURIComponent(searchQuery)}`
      : 'https://api.play.iprima.cz/v1/titles?limit=40';

    const res = await fetch(endpoint, { headers: HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.data || [];

    return items.map(item => ({
      id: `prima:${item.id}`,
      type: 'series',
      name: item.title,
      poster: item.cover_image?.url || '',
      description: item.description || 'Pořad skupiny Prima',
      genres: ['iPrima']
    }));
  } catch (err) {
    console.error('Prima Catalog Error:', err);
    return [];
  }
}

// 2. DETAIL POŘADU & EPIZODY
export async function getPrimaMeta(id) {
  try {
    const res = await fetch(`https://api.play.iprima.cz/v1/titles/${id}`, { headers: HEADERS });
    if (!res.ok) return null;

    const data = await res.json();
    const episodesRes = await fetch(`https://api.play.iprima.cz/v1/titles/${id}/episodes`, { headers: HEADERS });
    const episodesData = episodesRes.ok ? await episodesRes.json() : { data: [] };

    const videos = (episodesData.data || []).map((ep, idx) => ({
      id: `prima:${ep.id}`,
      title: ep.title || `Epizoda ${idx + 1}`,
      season: ep.season_number || 1,
      episode: ep.episode_number || idx + 1,
      thumbnail: ep.cover_image?.url || ''
    }));

    return {
      id: `prima:${id}`,
      type: 'series',
      name: data.title,
      poster: data.cover_image?.url || '',
      description: data.description || '',
      genres: ['iPrima'],
      videos: videos
    };
  } catch (err) {
    console.error('Prima Meta Error:', err);
    return null;
  }
}

// 3. STREAM (m3u8)
export async function getPrimaStream(id) {
  try {
    const res = await fetch(`https://api.play.iprima.cz/v1/episodes/${id}/play`, { headers: HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const streamUrl = data.stream_url || data.hls_url;

    if (streamUrl) {
      return [{
        title: 'iPrima HLS (Free)',
        url: streamUrl,
        type: 'hls'
      }];
    }
  } catch (err) {
    console.error('Prima Stream Error:', err);
  }
  return [];
}
