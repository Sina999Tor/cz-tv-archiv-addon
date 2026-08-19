import fetch from 'node-fetch';

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

// id je buď "tt1234567" (film) nebo "tt1234567:1:2" (seriál - season:episode)
export async function getStreams(type, id) {
  try {
    const url = `${TORRENTIO_BASE}/stream/${type}/${id}.json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.streams || [];
  } catch (err) {
    console.error('Torrentio Stream Error:', err);
    return [];
  }
}
