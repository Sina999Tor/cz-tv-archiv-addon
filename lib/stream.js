import fetch from 'node-fetch';

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

// id je buď "tt1234567" (film), "tt1234567:1:2" (seriál - season:episode),
// nebo náhradní "tmdb:12345" / "tmdb:12345:1:2" u titulů bez IMDb ID.
// Torrentio umí hledat jen podle IMDb ID, takže u "tmdb:" ID rovnou vrátíme
// prázdný seznam streamů — položka se v katalogu i detailu pořád zobrazí,
// jen bez možnosti přehrání.
export async function getStreams(type, id) {
  if (!id || !id.startsWith('tt')) return [];
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
