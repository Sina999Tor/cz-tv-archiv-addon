import fetch from 'node-fetch';

const TMDB_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';

async function tmdbGet(path, params = {}) {
  if (!TMDB_KEY) throw new Error('Chybí TMDB_API_KEY v environment proměnných.');
  const qs = new URLSearchParams({ api_key: TMDB_KEY, language: 'cs-CZ', ...params });
  const res = await fetch(`${BASE}${path}?${qs.toString()}`);
  if (!res.ok) throw new Error(`TMDB ${path} -> HTTP ${res.status}`);
  return res.json();
}

function sortParam(genre) {
  if (genre === 'Nejlépe hodnocené') return { sort_by: 'vote_average.desc', 'vote_count.gte': '100' };
  if (genre === 'Novinky') return { sort_by: 'primary_release_date.desc' };
  return { sort_by: 'popularity.desc' };
}

// Převede volbu z UI ("CZ + SK" / "Pouze CZ" / "Pouze SK") na TMDB with_origin_country
function countryParam(country) {
  if (country === 'Pouze CZ') return 'CZ';
  if (country === 'Pouze SK') return 'SK';
  return 'CZ|SK';
}

// Filtr výsledků search endpointu podle země původu.
// /search/tv vrací origin_country (pole zemí), /search/movie ho nemá — tam se
// jako přiblížení použije original_language (cs = CZ, sk = SK).
function filterByOrigin(results, country, originField) {
  if (country !== 'Pouze CZ' && country !== 'Pouze SK') return results;
  const targetCountry = country === 'Pouze CZ' ? 'CZ' : 'SK';
  const targetLang = country === 'Pouze CZ' ? 'cs' : 'sk';
  return results.filter(r => {
    if (originField && Array.isArray(r[originField])) {
      return r[originField].includes(targetCountry);
    }
    return r.original_language === targetLang;
  });
}

// --- KATALOG: FILMY ---
export async function discoverMovies({ genre = 'Populární', search = '', page = 1, country = 'CZ + SK' }) {
  let data;
  if (search) {
    data = await tmdbGet('/search/movie', { query: search, page, region: 'CZ' });
    data.results = filterByOrigin(data.results || [], country, null);
  } else {
    data = await tmdbGet('/discover/movie', {
      with_origin_country: countryParam(country),
      page,
      ...sortParam(genre)
    });
  }
  const results = data.results || [];

  const withIds = await Promise.all(results.map(async (m) => {
    let imdbId = null;
    try {
      const ext = await tmdbGet(`/movie/${m.id}/external_ids`);
      imdbId = ext.imdb_id || null;
    } catch { /* ignore */ }
    if (!imdbId) return null;
    return {
      id: imdbId,
      type: 'movie',
      name: m.title,
      poster: m.poster_path ? `${IMG}${m.poster_path}` : '',
      description: m.overview || '',
      releaseInfo: (m.release_date || '').slice(0, 4)
    };
  }));

  return withIds.filter(Boolean);
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries({ genre = 'Populární', search = '', page = 1, country = 'CZ + SK' }) {
  let data;
  if (search) {
    data = await tmdbGet('/search/tv', { query: search, page });
    data.results = filterByOrigin(data.results || [], country, 'origin_country');
  } else {
    const sp = sortParam(genre);
    if (sp.sort_by === 'primary_release_date.desc') sp.sort_by = 'first_air_date.desc';
    data = await tmdbGet('/discover/tv', {
      with_origin_country: countryParam(country),
      page,
      ...sp
    });
  }
  const results = data.results || [];

  const withIds = await Promise.all(results.map(async (s) => {
    let imdbId = null;
    try {
      const ext = await tmdbGet(`/tv/${s.id}/external_ids`);
      imdbId = ext.imdb_id || null;
    } catch { /* ignore */ }
    if (!imdbId) return null;
    return {
      id: imdbId,
      type: 'series',
      name: s.name,
      poster: s.poster_path ? `${IMG}${s.poster_path}` : '',
      description: s.overview || '',
      releaseInfo: (s.first_air_date || '').slice(0, 4)
    };
  }));

  return withIds.filter(Boolean);
}

// --- META: FILM ---
export async function getMovieMetaByImdb(imdbId) {
  const found = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const m = (found.movie_results || [])[0];
  if (!m) return null;
  const details = await tmdbGet(`/movie/${m.id}`);
  return {
    id: imdbId,
    type: 'movie',
    name: details.title,
    poster: details.poster_path ? `${IMG}${details.poster_path}` : '',
    background: details.backdrop_path ? `${IMG}${details.backdrop_path}` : '',
    description: details.overview || '',
    releaseInfo: (details.release_date || '').slice(0, 4),
    runtime: details.runtime ? `${details.runtime} min` : undefined,
    genres: (details.genres || []).map(g => g.name)
  };
}

// --- META: SERIÁL (se sezónami/epizodami) ---
export async function getSeriesMetaByImdb(imdbId) {
  const found = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const s = (found.tv_results || [])[0];
  if (!s) return null;
  const details = await tmdbGet(`/tv/${s.id}`);

  const seasons = (details.seasons || []).filter(se => se.season_number > 0);
  const seasonData = await Promise.all(seasons.map(se =>
    tmdbGet(`/tv/${s.id}/season/${se.season_number}`).catch(() => null)
  ));

  const videos = [];
  seasonData.forEach((sd) => {
    if (!sd || !sd.episodes) return;
    sd.episodes.forEach(ep => {
      videos.push({
        id: `${imdbId}:${sd.season_number}:${ep.episode_number}`,
        title: ep.name || `Epizoda ${ep.episode_number}`,
        season: sd.season_number,
        episode: ep.episode_number,
        released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
        thumbnail: ep.still_path ? `${IMG}${ep.still_path}` : undefined,
        overview: ep.overview || ''
      });
    });
  });

  return {
    id: imdbId,
    type: 'series',
    name: details.name,
    poster: details.poster_path ? `${IMG}${details.poster_path}` : '',
    background: details.backdrop_path ? `${IMG}${details.backdrop_path}` : '',
    description: details.overview || '',
    releaseInfo: (details.first_air_date || '').slice(0, 4),
    genres: (details.genres || []).map(g => g.name),
    videos
  };
}
