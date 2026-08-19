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

// Převede volbu z UI ("CZ + SK" / "Pouze CZ" / "Pouze SK") na TMDB with_original_language.
// Origin_country by pustil dovnitř i zahraniční koprodukce natáčené v ČR/SK (Doom, Dračí
// doupě...), proto se filtruje podle skutečného originálního jazyka snímku.
function languageParam(country) {
  if (country === 'Pouze CZ') return 'cs';
  if (country === 'Pouze SK') return 'sk';
  return 'cs|sk';
}

// Filtr výsledků pro /search endpointy (ty with_original_language nepodporují)
function filterByLanguage(results, country) {
  if (country === 'Pouze CZ') return results.filter(r => r.original_language === 'cs');
  if (country === 'Pouze SK') return results.filter(r => r.original_language === 'sk');
  return results.filter(r => r.original_language === 'cs' || r.original_language === 'sk');
}

// Stremio od addonu čeká vždy plnou stránku (PAGE_SIZE položek), jinak usoudí,
// že katalog skončil, a další scroll už nenačte. Protože část TMDB výsledků
// nemá IMDb ID (a vypadne), musíme podle potřeby dotáhnout další TMDB stránky,
// dokud nenasbíráme dost validních položek. Stránky i "external_ids" volání
// se dělají paralelně v dávkách, aby to stihlo timeout serverless funkce —
// při vyšším "skip" (hlubší scroll) je potřeba víc TMDB stránek a sekvenční
// natahování by se nevešlo do limitu.
const PAGE_SIZE = 20;
const MAX_TMDB_PAGES = 25; // pojistka proti nekonečné smyčce
const BATCH_SIZE = 5; // kolik TMDB stránek se natahuje paralelně najednou

async function collectPage({ fetchTmdbPage, mapItem, skip }) {
  const collected = [];
  let nextPage = 1;
  let totalPages = Infinity;

  while (collected.length < skip + PAGE_SIZE && nextPage <= totalPages && nextPage <= MAX_TMDB_PAGES) {
    const batchPages = [];
    for (let p = nextPage; p < nextPage + BATCH_SIZE && p <= totalPages && p <= MAX_TMDB_PAGES; p++) {
      batchPages.push(p);
    }
    if (batchPages.length === 0) break;

    const pageResults = await Promise.all(batchPages.map(p => fetchTmdbPage(p).catch(() => null)));

    for (const data of pageResults) {
      if (!data) continue;
      if (typeof data.total_pages === 'number') totalPages = data.total_pages;
      const results = data.results || [];
      const mapped = await Promise.all(results.map(mapItem));
      collected.push(...mapped.filter(Boolean));
    }

    nextPage += BATCH_SIZE;
  }

  return collected.slice(skip, skip + PAGE_SIZE);
}

// --- KATALOG: FILMY ---
export async function discoverMovies({ genre = 'Populární', search = '', skip = 0, country = 'CZ + SK' }) {
  const mapItem = async (m) => {
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
  };

  if (search) {
    return collectPage({
      skip,
      mapItem,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet('/search/movie', { query: search, page: p, region: 'CZ' });
        return { ...data, results: filterByLanguage(data.results || [], country) };
      }
    });
  }

  return collectPage({
    skip,
    mapItem,
    fetchTmdbPage: (p) => tmdbGet('/discover/movie', {
      with_original_language: languageParam(country),
      page: p,
      ...sortParam(genre)
    })
  });
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries({ genre = 'Populární', search = '', skip = 0, country = 'CZ + SK' }) {
  const mapItem = async (s) => {
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
  };

  if (search) {
    return collectPage({
      skip,
      mapItem,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet('/search/tv', { query: search, page: p });
        return { ...data, results: filterByLanguage(data.results || [], country) };
      }
    });
  }

  const sp = sortParam(genre);
  if (sp.sort_by === 'primary_release_date.desc') sp.sort_by = 'first_air_date.desc';

  return collectPage({
    skip,
    mapItem,
    fetchTmdbPage: (p) => tmdbGet('/discover/tv', {
      with_original_language: languageParam(country),
      page: p,
      ...sp
    })
  });
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
