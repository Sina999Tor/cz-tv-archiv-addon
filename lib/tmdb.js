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

// --- ŘAZENÍ (dřív se tomuhle říkalo "genre", ale ve skutečnosti to vždycky
// bylo jen řazení výpisu — skutečné žánry (Akční, Komedie, ...) řeší GENRE
// mapy níže a jsou to dva nezávislé filtry). ---
function sortModeParam(sort) {
  if (sort === 'Nejlépe hodnocené') return { sort_by: 'vote_average.desc' };
  if (sort === 'Novinky') return { sort_by: 'primary_release_date.desc' };
  return { sort_by: 'popularity.desc' };
}

// --- SKUTEČNÉ ŽÁNRY (TMDB genre ID, které jsou stabilní napříč jazyky) ---
// Film a seriál mají u TMDB každý mírně jinou sadu ID, proto dvě mapy.
export const MOVIE_GENRES = [
  ['Akční', 28], ['Dobrodružný', 12], ['Animovaný', 16], ['Komedie', 35],
  ['Krimi', 80], ['Dokumentární', 99], ['Drama', 18], ['Rodinný', 10751],
  ['Fantasy', 14], ['Historický', 36], ['Horor', 27], ['Hudební', 10402],
  ['Mysteriózní', 9648], ['Romantický', 10749], ['Sci-Fi', 878],
  ['Thriller', 53], ['Válečný', 10752], ['Western', 37]
];
export const SERIES_GENRES = [
  ['Akční a dobrodružné', 10759], ['Animovaný', 16], ['Komedie', 35],
  ['Krimi', 80], ['Dokumentární', 99], ['Drama', 18], ['Rodinný', 10751],
  ['Dětský', 10762], ['Mysteriózní', 9648], ['Zpravodajský', 10763],
  ['Reality show', 10764], ['Sci-Fi a fantasy', 10765], ['Telenovela', 10766],
  ['Talk show', 10767], ['Válečný a politický', 10768], ['Western', 37]
];
const movieGenreId = (name) => (MOVIE_GENRES.find(([n]) => n === name) || [])[1] || null;
const seriesGenreId = (name) => (SERIES_GENRES.find(([n]) => n === name) || [])[1] || null;
// /search endpointy with_genres nepodporují, takže se u nich žánr dofiltruje
// na klientu podle genre_ids, které search výsledky obsahují taky.
const hasGenre = (item, genreId) => !genreId || (item.genre_ids || []).includes(genreId);

// Převede volbu z UI ("CZ + SK" / "Pouze CZ" / "Pouze SK" / "Vše") na TMDB
// with_original_language. Origin_country by pustil dovnitř i zahraniční
// koprodukce natáčené v ČR/SK (Doom, Dračí doupě...), proto se filtruje podle
// skutečného originálního jazyka snímku. "Vše" žádný jazykový filtr neaplikuje
// — katalog pak není omezený jen na CZ/SK tvorbu.
function languageParam(country) {
  if (country === 'Pouze CZ') return 'cs';
  if (country === 'Pouze SK') return 'sk';
  if (country === 'Vše') return null;
  return 'cs|sk';
}

// Filtr výsledků pro /search endpointy (ty with_original_language nepodporují)
function filterByLanguage(results, country) {
  if (country === 'Vše') return results;
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
    let stopHere = null;
    for (let i = 0; i < pageResults.length; i++) {
      const data = pageResults[i];
      if (!data) continue;
      if (typeof data.total_pages === 'number') progress.totalPages = Math.min(progress.totalPages, data.total_pages);
      for (const raw of data.results || []) {
        const key = getKey(raw);
        if (key == null || progress.seen.has(key)) continue;
        progress.seen.add(key);
        batchItems.push(raw);
      }
      // fetchTmdbPage může signalizovat, že další stránky už nemá smysl číst
      // (viz early-exit u filtru podle roku níže) — jakmile na to narazíme,
      // oříznou se total_pages hned za tuhle dávku, ať smyčka skončí.
      if (data.stop && stopHere == null) stopHere = batchPages[i];
    }
    if (stopHere != null) progress.totalPages = Math.min(progress.totalPages, stopHere);

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

// Discover dotaz pro konkrétní rok: řadí se chronologicky (podle "primárního"
// data TMDB — u drtivé většiny filmů/seriálů je to i tak rok skutečného
// vydání, jen u pár CZ/SK titulů se to může lišit o rok) a jakmile dávka
// stránek už obsahuje jen tituly citelně starší než hledaný rok, dál se
// nescanuje — bez tohohle by hledání staršího/málo obsazeného roku muselo
// projít klidně stovky stránek celého katalogu, než by (ne)našlo dost shod.
function withYearScan(fetchRawPage, dateField, year) {
  return async (p) => {
    const data = await fetchRawPage(p);
    const raw = data.results || [];
    const results = raw.filter(r => (r[dateField] || '').slice(0, 4) === year);
    const years = raw
      .map(r => parseInt((r[dateField] || '').slice(0, 4), 10))
      .filter(y => !isNaN(y));
    const minYear = years.length ? Math.min(...years) : null;
    const stop = minYear !== null && minYear < Number(year) - 1;
    return { ...data, results, stop };
  };
}

// --- KATALOG: FILMY ---
export async function discoverMovies(apiKey, { sort = 'Populární', genre = '', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const genreId = movieGenreId(genre);

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
      progressKey: `movie-search:${apiKey}:${stableKey({ search, country, year, genre })}`,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet(apiKey, '/search/movie', { query: search, page: p, region: 'CZ' });
        let results = filterByLanguage(data.results || [], country);
        if (year) results = results.filter(r => (r.release_date || '').slice(0, 4) === year);
        if (genreId) results = results.filter(r => hasGenre(r, genreId));
        return { ...data, results };
      }
    });
  }

  const lang = languageParam(country);
  const rawPage = (p) => tmdbGet(apiKey, '/discover/movie', {
    ...(lang ? { with_original_language: lang } : {}),
    ...(genreId ? { with_genres: genreId } : {}),
    page: p,
    // primary_release_date.gte/lte i release_date.gte/lte+region jsou nespolehlivé
    // pro server-side filtrování CZ/SK titulů podle roku (spousta jich v TMDB nemá
    // vyplněné/regionální datum), proto se rok filtruje na klientu (viz withYearScan)
    // a řazení se pro rok přepne na chronologické kvůli early-exitu.
    ...(year ? { sort_by: 'primary_release_date.desc' } : sortModeParam(sort))
  });

  return collectPage({
    skip,
    mapItem,
    getKey: (m) => m && m.id,
    progressKey: `movie-discover:${apiKey}:${stableKey({ sort, genre, country, year })}`,
    fetchTmdbPage: year ? withYearScan(rawPage, 'release_date', year) : rawPage
  });
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries(apiKey, { sort = 'Populární', genre = '', search = '', skip = 0, country = 'CZ + SK', year = '' }) {
  const genreId = seriesGenreId(genre);

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
      progressKey: `series-search:${apiKey}:${stableKey({ search, country, year, genre })}`,
      fetchTmdbPage: async (p) => {
        const data = await tmdbGet(apiKey, '/search/tv', { query: search, page: p });
        let results = filterByLanguage(data.results || [], country);
        if (year) results = results.filter(r => (r.first_air_date || '').slice(0, 4) === year);
        if (genreId) results = results.filter(r => hasGenre(r, genreId));
        return { ...data, results };
      }
    });
  }

  const sp = sortModeParam(sort);
  if (sp.sort_by === 'primary_release_date.desc') sp.sort_by = 'first_air_date.desc';

  const lang = languageParam(country);
  const rawPage = (p) => tmdbGet(apiKey, '/discover/tv', {
    ...(lang ? { with_original_language: lang } : {}),
    ...(genreId ? { with_genres: genreId } : {}),
    page: p,
    ...(year ? { sort_by: 'first_air_date.desc' } : sp)
  });

  return collectPage({
    skip,
    mapItem,
    getKey: (s) => s && s.id,
    progressKey: `series-discover:${apiKey}:${stableKey({ sort, genre, country, year })}`,
    fetchTmdbPage: year ? withYearScan(rawPage, 'first_air_date', year) : rawPage
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
