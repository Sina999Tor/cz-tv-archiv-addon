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
  if (genre === 'Nejlépe hodnocené') return { sort_by: 'vote_average.desc' };
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

// Žádné filtrování podle vote_count ani IMDb ID — nic se nezahazuje.
// Položky bez IMDb ID dostanou náhradní "tmdb:<id>" identifikátor (viz mapItem
// níže), takže se pořád zobrazí a stránkování zůstane plné → nekonečný scroll
// se nikdy nezastaví dřív, než opravdu dojdou data na TMDB.
const PAGE_SIZE = 20;
const MAX_TMDB_PAGES = 500; // reálný strop TMDB API (dál stejně nejde stránkovat)
const BATCH_SIZE = 8; // kolik TMDB stránek se natahuje paralelně najednou

// Průběh skenování TMDB stránek pro danou kombinaci filtrů (žánr/jazyk/rok/...),
// nezávisle na 'skip'. Bez tohohle by collectPage musel při každém dalším
// "načíst další" requestu (rostoucí skip) začínat znovu od TMDB stránky 1 a
// znovu procházet a filtrovat všechno od začátku — s rostoucím skip to bylo
// pomalejší a pomalejší, až to spolehlivě po pár dávkách timeoutlo (Vercel
// limit 30s ve vercel.json). Teď se pozice skenování, nalezené položky i
// total_pages pro danou kombinaci filtrů uchovávají v paměti (stejná
// "přežívá jen dokud je instance teplá" logika jako cache výše) a další
// požadavek na vyšší skip navazuje přesně tam, kde předchozí skončil.
const PROGRESS_TTL_MS = 15 * 60 * 1000;
const progressStore = new Map();

function stableKey(obj) {
  return Object.keys(obj).sort().map(k => `${k}=${obj[k]}`).join('&');
}

async function collectPage({ fetchTmdbPage, mapItem, getKey, skip, progressKey }) {
  let progress = progressStore.get(progressKey);
  if (!progress || Date.now() - progress.time > PROGRESS_TTL_MS) {
    progress = {
      items: [],
      seen: new Set(), // TMDB discover umí u málo populárních/remízových položek vrátit
                        // stejnou položku na víc stránkách zároveň — bez dedupe by to
                        // "sežralo" místo dalším unikátním filmům a snížilo reálný počet.
      nextPage: 1,
      totalPages: Infinity
    };
  }

  while (progress.items.length < skip + PAGE_SIZE && progress.nextPage <= progress.totalPages && progress.nextPage <= MAX_TMDB_PAGES) {
    const batchPages = [];
    for (let p = progress.nextPage; p < progress.nextPage + BATCH_SIZE && p <= progress.totalPages && p <= MAX_TMDB_PAGES; p++) {
      batchPages.push(p);
    }
    if (batchPages.length === 0) break;

    const pageResults = await Promise.all(batchPages.map(p => fetchTmdbPage(p).catch(() => null)));

    const batchItems = [];
    for (const data of pageResults) {
      if (!data) continue;
      if (typeof data.total_pages === 'number') progress.totalPages = data.total_pages;
      for (const raw of data.results || []) {
        const key = getKey(raw);
        if (key == null || progress.seen.has(key)) continue;
        progress.seen.add(key);
        batchItems.push(raw);
      }
    }
    // mapItem se snaží dohledat IMDb ID, ale nikdy nevrací null jen kvůli
    // tomu, že chybí — na chybu/absenci ID addon nezastavuje výpis, jen
    // danou položku označí náhradním ID a jede dál.
    const mapped = await Promise.all(batchItems.map(mapItem));
    progress.items.push(...mapped.filter(Boolean));

    progress.nextPage += BATCH_SIZE;
  }

  progress.time = Date.now();
  progressStore.set(progressKey, progress);

  return progress.items.slice(skip, skip + PAGE_SIZE);
}

// --- KATALOG: FILMY ---
export async function discoverMovies(apiKey, { genre = 'Populární', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const mapItem = async (m) => {
    if (!m || !m.id || !m.title) return null; // opravdu prázdný/rozbitý záznam z TMDB, nic víc
    let imdbId = null;
    try {
      const ext = await tmdbGet(apiKey, `/movie/${m.id}/external_ids`);
      imdbId = ext.imdb_id || null;
    } catch { /* bez IMDb ID to není chyba, jede se dál s náhradním ID */ }
    return {
      id: imdbId || `tmdb:${m.id}`,
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
      getKey: (m) => m && m.id,
      progressKey: `movie-search:${apiKey}:${stableKey({ search, country, year })}`,
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
    getKey: (m) => m && m.id,
    progressKey: `movie-discover:${apiKey}:${stableKey({ genre, country, year })}`,
    // primary_release_date.gte/lte i release_date.gte/lte+region jsou nespolehlivé:
    // obě metody hledají explicitní záznam v TMDB tabulce "release_dates" pro danou
    // zemi/typ vydání, a spousta CZ/SK titulů tam žádný takový záznam vůbec nemá —
    // i s region filtrem tak TMDB vrátí jen malou podmnožinu (proto se stránkování
    // po pár dávkách zastavilo, i když filmů z daného roku je ve skutečnosti mnohem
    // víc). Řešení: žádný server-side filtr podle data, jen si necháme TMDB projet
    // celý cs|sk katalog (řazený podle žánru/popularity) a rok dofiltrujeme na
    // klientu podle vlastního pole release_date, které TMDB u filmu má prakticky
    // vždy — stejně jako to už dělá /search/movie výše.
    fetchTmdbPage: async (p) => {
      const data = await tmdbGet(apiKey, '/discover/movie', {
        with_original_language: languageParam(country),
        page: p,
        ...sortParam(genre)
      });
      if (!year) return data;
      const results = (data.results || []).filter(r => (r.release_date || '').slice(0, 4) === year);
      return { ...data, results };
    }
  });
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries(apiKey, { genre = 'Populární', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const mapItem = async (s) => {
    if (!s || !s.id || !s.name) return null;
    let imdbId = null;
    try {
      const ext = await tmdbGet(apiKey, `/tv/${s.id}/external_ids`);
      imdbId = ext.imdb_id || null;
    } catch { /* bez IMDb ID to není chyba, jede se dál s náhradním ID */ }
    return {
      id: imdbId || `tmdb:${s.id}`,
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
      getKey: (s) => s && s.id,
      progressKey: `series-search:${apiKey}:${stableKey({ search, country, year })}`,
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
    getKey: (s) => s && s.id,
    progressKey: `series-discover:${apiKey}:${stableKey({ genre, country, year })}`,
    // first_air_date.gte/lte samo o sobě je spolehlivější než primary_release_date u
    // filmů (seriál má jedno první vysílání, ne "primární vs. regionální" verze), ale
    // v kombinaci s úzkým jazykovým filtrem (cs|sk) pořád jde jen o malou podmnožinu
    // TMDB katalogu, takže filtr na serveru zbytečně snižuje total_pages a stránkování
    // se pak brzy vyčerpá. Stejně jako u filmů: žádný server-side date filtr, rok se
    // dofiltruje na klientu podle first_air_date.
    fetchTmdbPage: async (p) => {
      const data = await tmdbGet(apiKey, '/discover/tv', {
        with_original_language: languageParam(country),
        page: p,
        ...sp
      });
      if (!year) return data;
      const results = (data.results || []).filter(r => (r.first_air_date || '').slice(0, 4) === year);
      return { ...data, results };
    }
  });
}

// --- META: FILM --- (id může být "tt1234567" nebo náhradní "tmdb:12345")
export async function getMovieMeta(apiKey, id) {
  let details;
  if (id.startsWith('tmdb:')) {
    const tmdbId = id.slice(5);
    details = await tmdbGet(apiKey, `/movie/${tmdbId}`);
  } else {
    const found = await tmdbGet(apiKey, `/find/${id}`, { external_source: 'imdb_id' });
    const m = (found.movie_results || [])[0];
    if (!m) return null;
    details = await tmdbGet(apiKey, `/movie/${m.id}`);
  }
  if (!details || !details.id) return null;
  return {
    id,
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

// --- META: SERIÁL (se sezónami/epizodami) --- (id může být "tt1234567" nebo náhradní "tmdb:12345")
export async function getSeriesMeta(apiKey, id) {
  let details;
  if (id.startsWith('tmdb:')) {
    const tmdbId = id.slice(5);
    details = await tmdbGet(apiKey, `/tv/${tmdbId}`);
  } else {
    const found = await tmdbGet(apiKey, `/find/${id}`, { external_source: 'imdb_id' });
    const s = (found.tv_results || [])[0];
    if (!s) return null;
    details = await tmdbGet(apiKey, `/tv/${s.id}`);
  }
  if (!details || !details.id) return null;

  const seasons = (details.seasons || []).filter(se => se.season_number > 0);
  const seasonData = await Promise.all(seasons.map(se =>
    tmdbGet(apiKey, `/tv/${details.id}/season/${se.season_number}`).catch(() => null)
  ));

  const videos = [];
  seasonData.forEach((sd) => {
    if (!sd || !sd.episodes) return;
    sd.episodes.forEach(ep => {
      videos.push({
        id: `${id}:${sd.season_number}:${ep.episode_number}`,
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
    id,
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
