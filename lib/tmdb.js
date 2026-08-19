import fetch from 'node-fetch';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';

// Jednoduchá in-memory cache (přežívá jen dokud je serverless instance "teplá",
// ale při běžném scrollování ve stejné relaci šetří spoustu opakovaných
// TMDB volání – hlavně external_ids, které se jinak volají znovu pro každou
// stránku i když se stránky překrývají). Klíč cache obsahuje i TMDB klíč,
// protože teď může každý uživatel addonu mít vlastní.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

async function tmdbGet(apiKey, path, params = {}) {
  if (!apiKey) {
    throw new Error('Chybí TMDB API klíč. Nainstaluj doplněk znovu přes konfigurační stránku (/configure).');
  }
  const qs = new URLSearchParams({ api_key: apiKey, language: 'cs-CZ', ...params });
  const cacheKey = `${apiKey}:${path}?${qs.toString()}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data;

  const res = await fetch(`${BASE}${path}?${qs.toString()}`);
  if (!res.ok) throw new Error(`TMDB ${path} -> HTTP ${res.status}`);
  const data = await res.json();
  cache.set(cacheKey, { data, time: Date.now() });
  return data;
}

function sortParam(genre) {
  if (genre === 'Nejlépe hodnocené') return { sort_by: 'vote_average.desc', 'vote_count.gte': '100' };
  if (genre === 'Novinky') return { sort_by: 'primary_release_date.desc' };
  return { sort_by: 'popularity.desc' };
}

// Bez vote_count filtru vrací TMDB discover obrovské množství naprosto
// okrajových/amatérských záznamů bez IMDb ID (krátké TV pořady, festivalové
// snímky apod.), které pak stejně vypadnou při hledání imdb_id — a zbytečně
// tak "spotřebují" stránky z MAX_TMDB_PAGES limitu. "Novinky" mají vote_count
// nízký záměrně (jsou nové), proto se tam filtr nepoužívá. Když je zvolený
// konkrétní ROK, filtr se taky vypíná — rok sám o sobě už výsledky dost zúží
// a spousta CZ/SK titulů na TMDB nemá žádné hodnocení, takže by je vote_count
// zbytečně vyřadil a katalog by u daného roku působil skoro prázdný.
function voteCountFloor(genre, year) {
  if (genre === 'Novinky' || year) return {};
  return { 'vote_count.gte': '1' };
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
const MAX_TMDB_PAGES_DEFAULT = 100; // pojistka pro neomezené procházení (bez roku) - 2000 syrových záznamů
const MAX_TMDB_PAGES_YEAR = 500; // TMDB API strop; u konkrétního roku je totalPages přirozeně malý,
                                  // takže je bezpečné jít až na reálný limit a nepřicházet o výsledky
const BATCH_SIZE = 8; // kolik TMDB stránek se natahuje paralelně najednou

async function collectPage({ fetchTmdbPage, mapItem, skip, maxPages = MAX_TMDB_PAGES_DEFAULT }) {
  const collected = [];
  let nextPage = 1;
  let totalPages = Infinity;

  while (collected.length < skip + PAGE_SIZE && nextPage <= totalPages && nextPage <= maxPages) {
    const batchPages = [];
    for (let p = nextPage; p < nextPage + BATCH_SIZE && p <= totalPages && p <= maxPages; p++) {
      batchPages.push(p);
    }
    if (batchPages.length === 0) break;

    const pageResults = await Promise.all(batchPages.map(p => fetchTmdbPage(p).catch(() => null)));

    // Vezmi všechny položky z celé dávky stránek a zpracuj je (external_ids apod.)
    // najednou paralelně, ne stránku po stránce – zásadně to zrychlí hlubší scroll.
    const batchItems = [];
    for (const data of pageResults) {
      if (!data) continue;
      if (typeof data.total_pages === 'number') totalPages = data.total_pages;
      batchItems.push(...(data.results || []));
    }
    const mapped = await Promise.all(batchItems.map(mapItem));
    collected.push(...mapped.filter(Boolean));

    nextPage += BATCH_SIZE;
  }

  return collected.slice(skip, skip + PAGE_SIZE);
}

// --- KATALOG: FILMY ---
export async function discoverMovies(apiKey, { genre = 'Populární', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const mapItem = async (m) => {
    let imdbId = null;
    try {
      const ext = await tmdbGet(apiKey, `/movie/${m.id}/external_ids`);
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
      maxPages: year ? MAX_TMDB_PAGES_YEAR : MAX_TMDB_PAGES_DEFAULT,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet(apiKey, '/search/movie', { query: search, page: p, region: 'CZ' });
        let results = filterByLanguage(data.results || [], country);
        if (year) results = results.filter(r => (r.release_date || '').slice(0, 4) === year);
        return { ...data, results };
      }
    });
  }

  return collectPage({
    skip,
    mapItem,
    maxPages: year ? MAX_TMDB_PAGES_YEAR : MAX_TMDB_PAGES_DEFAULT,
    fetchTmdbPage: (p) => tmdbGet(apiKey, '/discover/movie', {
      with_original_language: languageParam(country),
      page: p,
      ...(year ? { 'primary_release_date.gte': `${year}-01-01`, 'primary_release_date.lte': `${year}-12-31` } : {}),
      ...voteCountFloor(genre, year),
      ...sortParam(genre)
    })
  });
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries(apiKey, { genre = 'Populární', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const mapItem = async (s) => {
    let imdbId = null;
    try {
      const ext = await tmdbGet(apiKey, `/tv/${s.id}/external_ids`);
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
      maxPages: year ? MAX_TMDB_PAGES_YEAR : MAX_TMDB_PAGES_DEFAULT,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet(apiKey, '/search/tv', { query: search, page: p });
        let results = filterByLanguage(data.results || [], country);
        if (year) results = results.filter(r => (r.first_air_date || '').slice(0, 4) === year);
        return { ...data, results };
      }
    });
  }

  const sp = sortParam(genre);
  if (sp.sort_by === 'primary_release_date.desc') sp.sort_by = 'first_air_date.desc';

  return collectPage({
    skip,
    mapItem,
    maxPages: year ? MAX_TMDB_PAGES_YEAR : MAX_TMDB_PAGES_DEFAULT,
    fetchTmdbPage: (p) => tmdbGet(apiKey, '/discover/tv', {
      with_original_language: languageParam(country),
      page: p,
      ...(year ? { 'first_air_date.gte': `${year}-01-01`, 'first_air_date.lte': `${year}-12-31` } : {}),
      ...voteCountFloor(genre, year),
      ...sp
    })
  });
}

// --- META: FILM ---
export async function getMovieMetaByImdb(apiKey, imdbId) {
  const found = await tmdbGet(apiKey, `/find/${imdbId}`, { external_source: 'imdb_id' });
  const m = (found.movie_results || [])[0];
  if (!m) return null;
  const details = await tmdbGet(apiKey, `/movie/${m.id}`);
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
export async function getSeriesMetaByImdb(apiKey, imdbId) {
  const found = await tmdbGet(apiKey, `/find/${imdbId}`, { external_source: 'imdb_id' });
  const s = (found.tv_results || [])[0];
  if (!s) return null;
  const details = await tmdbGet(apiKey, `/tv/${s.id}`);

  const seasons = (details.seasons || []).filter(se => se.season_number > 0);
  const seasonData = await Promise.all(seasons.map(se =>
    tmdbGet(apiKey, `/tv/${s.id}/season/${se.season_number}`).catch(() => null)
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
