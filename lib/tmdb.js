import fetch from 'node-fetch';
import { Redis } from '@upstash/redis';

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
// Sort/žánr filtr v manifestu už není — vždy se řadí od nejnovějšího po nejstarší
// v rámci zvoleného žánru (a případně jazyka/země).

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

// Dnešní datum ve formátu TMDB (YYYY-MM-DD) — používá se k vyřazení titulů,
// které mají v TMDB nastavené datum vydání/premiéry v budoucnosti (ještě nevyšly).
const todayISO = () => new Date().toISOString().slice(0, 10);
// Tvrdá pojistka: TMDB filtr primary_release_date.lte/first_air_date.lte se
// u některých (chybně vyplněných / spekulativních) záznamů neuplatní spolehlivě,
// takže se navíc kontroluje přímo v mapItem, že rok vydání není v budoucnosti.
const CURRENT_YEAR = new Date().getFullYear();

// TMDB nemá přímý ukazatel "kolikrát bylo něco pouštěno/navštěvováno" (to sleduje
// jen streamovací platformy interně), takže se u "Nejčastěji navštěvované"
// používá jako nejbližší dostupná náhrada tržby v kinech (revenue) a u
// "Oblíbené" počet hodnocení (vote_count) jako proxy pro to, kolik lidí titul
// vůbec sledovalo/ohodnotilo. "Vše" = bez konkrétního řazení (výchozí pořadí TMDB).
function sortModeParam(sort) {
  if (sort === 'Nejlépe hodnocené') return { sort_by: 'vote_average.desc' };
  if (sort === 'Oblíbené') return { sort_by: 'vote_count.desc' };
  if (sort === 'Nejčastěji navštěvované') return { sort_by: 'revenue.desc' };
  if (sort === 'Vše') return {};
  return { sort_by: 'popularity.desc' }; // Populární (výchozí)
}
// Položky bez IMDb ID dostanou náhradní "tmdb:<id>" identifikátor (viz mapItem
// níže), takže se pořád zobrazí a stránkování zůstane plné → nekonečný scroll
// se nikdy nezastaví dřív, než opravdu dojdou data na TMDB.
const PAGE_SIZE = 20;
const MAX_TMDB_PAGES = 500; // reálný strop TMDB API (dál stejně nejde stránkovat)
const BATCH_SIZE = 8; // kolik TMDB stránek se natahuje paralelně najednou
// Katalog vždy prochází roky od aktuálního (CURRENT_YEAR, dnes 2026) směrem
// dolů do minulosti a zastaví se na MIN_YEAR — starší tituly se už nenabízí.
const MIN_YEAR = 1975;

// Průběh skenování TMDB stránek pro danou kombinaci filtrů (žánr/jazyk/rok/...),
// nezávisle na 'skip'. Bez tohohle by collectByYear musel při každém dalším
// "načíst další" requestu (rostoucí skip) začínat znovu od TMDB stránky 1 a
// znovu procházet a filtrovat všechno od začátku — s rostoucím skip to bylo
// pomalejší a pomalejší, až to spolehlivě po pár dávkách timeoutlo (Vercel
// limit 30s ve vercel.json). Teď se pozice skenování, nalezené položky i
// total_pages pro danou kombinaci filtrů uchovávají v paměti (stejná
// "přežívá jen dokud je instance teplá" logika jako cache výše) a další
// požadavek na vyšší skip navazuje přesně tam, kde předchozí skončil.
const PROGRESS_TTL_MS = 15 * 60 * 1000;

// Vercel serverless funkce neběží v jedné trvalé instanci — u souběžných/
// škálovaných requestů (přesně to, co dělá nekonečný scroll) se běžně skáče
// mezi různými instancemi procesu bez sdíleného stavu, takže in-memory Map
// pro progress fungovala nespolehlivě ("náhodně to funguje, náhodně ne").
// Progress se proto ukládá do Upstash Redis (REST, funguje z jakékoli
// instance/regionu) — pokud env proměnné chybí, spadne se zpátky na
// in-memory Map, ať addon aspoň lokálně/na jedné instanci pořád jede.
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null;
if (!redis) {
  console.warn('UPSTASH_REDIS_REST_URL/TOKEN nejsou nastavené — nekonečný scroll poběží ' +
    'jen na in-memory fallbacku a bude se chovat nespolehlivě mezi instancemi.');
}
const memoryProgressStore = new Map();

function serializeProgress(progress) {
  return { ...progress, seen: Array.from(progress.seen) };
}
function deserializeProgress(raw) {
  if (!raw) return null;
  return { ...raw, seen: new Set(raw.seen || []) };
}

async function loadProgress(progressKey) {
  if (redis) {
    const raw = await redis.get(progressKey).catch(() => null);
    return deserializeProgress(raw);
  }
  const p = memoryProgressStore.get(progressKey);
  if (!p || Date.now() - p.time > PROGRESS_TTL_MS) return null;
  return p;
}

async function saveProgress(progressKey, progress) {
  progress.time = Date.now();
  if (redis) {
    await redis.set(progressKey, serializeProgress(progress), { ex: Math.ceil(PROGRESS_TTL_MS / 1000) })
      .catch(err => console.error('Redis progress save failed:', err));
    return;
  }
  memoryProgressStore.set(progressKey, progress);
}

function stableKey(obj) {
  return Object.keys(obj).sort().map(k => `${k}=${obj[k]}`).join('&');
}

// Skenuje katalog ROK PO ROCE, vždy od CURRENT_YEAR (dnes 2026) směrem dolů
// do minulosti až po MIN_YEAR (1975) — v rámci každého roku se prochází TMDB
// stránky podle zvoleného řazení (fetchYearPage dostane year + page a sám
// aplikuje sort/jazyk/žánr filtry). Jakmile je aktuální rok vyčerpaný
// (došly stránky), scan pokračuje dalším, o rok starším. Díky tomu se výpis
// vždy drží chronologicky sestupně 2026 → 1975 bez ohledu na to, jaké
// řazení/jazyk/žánr je zrovna zvolený — ty se uplatní jen v rámci každého
// jednotlivého roku.
async function collectByYear({ fetchYearPage, mapItem, getKey, skip, progressKey }) {
  let progress = await loadProgress(progressKey);
  if (!progress) {
    progress = {
      items: [],
      seen: new Set(), // TMDB discover umí u málo populárních/remízových položek vrátit
                        // stejnou položku na víc stránkách zároveň — bez dedupe by to
                        // "sežralo" místo dalším unikátním filmům a snížilo reálný počet.
      year: CURRENT_YEAR,
      nextPage: 1,
      yearTotalPages: null // total_pages pro aktuálně skenovaný rok, zjistí se z první odpovědi
    };
  }

  while (progress.items.length < skip + PAGE_SIZE && progress.year >= MIN_YEAR) {
    const capPages = Math.min(progress.yearTotalPages ?? MAX_TMDB_PAGES, MAX_TMDB_PAGES);
    const batchPages = [];
    for (let p = progress.nextPage; p < progress.nextPage + BATCH_SIZE && p <= capPages; p++) {
      batchPages.push(p);
    }

    if (batchPages.length === 0) {
      // Aktuální rok je vyčerpaný (došly stránky) -> pokračuj o rok starším.
      progress.year -= 1;
      progress.nextPage = 1;
      progress.yearTotalPages = null;
      continue;
    }

    const yearNow = progress.year;
    const pageResults = await Promise.all(batchPages.map(p => fetchYearPage(yearNow, p).catch(() => null)));

    const batchItems = [];
    for (const data of pageResults) {
      if (!data) continue;
      if (typeof data.total_pages === 'number') {
        progress.yearTotalPages = progress.yearTotalPages == null
          ? data.total_pages
          : Math.max(progress.yearTotalPages, data.total_pages);
      }
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
    if (progress.yearTotalPages != null && progress.nextPage > progress.yearTotalPages) {
      progress.year -= 1;
      progress.nextPage = 1;
      progress.yearTotalPages = null;
    }
  }

  await saveProgress(progressKey, progress);

  return progress.items.slice(skip, skip + PAGE_SIZE);
}

// --- KATALOG: FILMY ---
export async function discoverMovies(apiKey, { sort = 'Populární', search = '', skip = 0, country = 'CZ + SK' }) {
  const mapItem = async (m) => {
    if (!m || !m.id || !m.title) return null; // opravdu prázdný/rozbitý záznam z TMDB, nic víc
    const releaseYear = Number((m.release_date || '').slice(0, 4));
    if (releaseYear && releaseYear > CURRENT_YEAR) return null; // ještě nevyšlo
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
    return collectByYear({
      skip,
      mapItem,
      getKey: (m) => m && m.id,
      progressKey: `movie-search:${apiKey}:${stableKey({ search, country })}`,
      fetchYearPage: async (year, p) => {
        const data = await tmdbGet(apiKey, '/search/movie', { query: search, page: p, region: 'CZ', primary_release_year: year });
        let results = filterByLanguage(data.results || [], country);
        results = results.filter(r => !r.release_date || r.release_date <= todayISO());
        return { ...data, results };
      }
    });
  }

  const lang = languageParam(country);
  // primary_release_year omezí dotaz vždy jen na konkrétní rok (viz collectByYear),
  // primary_release_date.lte navíc vyřadí u aktuálního roku ještě nevydané tituly.
  const rawYearPage = (year, p) => tmdbGet(apiKey, '/discover/movie', {
    ...(lang ? { with_original_language: lang } : {}),
    page: p,
    primary_release_year: year,
    'primary_release_date.lte': todayISO(),
    ...sortModeParam(sort)
  });

  return collectByYear({
    skip,
    mapItem,
    getKey: (m) => m && m.id,
    progressKey: `movie-discover:${apiKey}:${stableKey({ sort, country })}`,
    fetchYearPage: rawYearPage
  });
}

// --- KATALOG: SERIÁLY ---
export async function discoverSeries(apiKey, { sort = 'Populární', search = '', skip = 0, country = 'CZ + SK' }) {
  const mapItem = async (s) => {
    if (!s || !s.id || !s.name) return null;
    const airYear = Number((s.first_air_date || '').slice(0, 4));
    if (airYear && airYear > CURRENT_YEAR) return null; // ještě neproběhla premiéra
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
    return collectByYear({
      skip,
      mapItem,
      getKey: (s) => s && s.id,
      progressKey: `series-search:${apiKey}:${stableKey({ search, country })}`,
      fetchYearPage: async (year, p) => {
        const data = await tmdbGet(apiKey, '/search/tv', { query: search, page: p, first_air_date_year: year });
        let results = filterByLanguage(data.results || [], country);
        results = results.filter(r => !r.first_air_date || r.first_air_date <= todayISO());
        return { ...data, results };
      }
    });
  }

  const sp = sortModeParam(sort);
  if (sp.sort_by === 'revenue.desc') delete sp.sort_by; // /discover/tv revenue.desc nepodporuje

  const lang = languageParam(country);
  // first_air_date_year omezí dotaz vždy jen na konkrétní rok (viz collectByYear),
  // first_air_date.lte navíc vyřadí u aktuálního roku ještě neodvysílané tituly.
  const rawYearPage = (year, p) => tmdbGet(apiKey, '/discover/tv', {
    ...(lang ? { with_original_language: lang } : {}),
    page: p,
    first_air_date_year: year,
    'first_air_date.lte': todayISO(),
    ...sp
  });

  return collectByYear({
    skip,
    mapItem,
    getKey: (s) => s && s.id,
    progressKey: `series-discover:${apiKey}:${stableKey({ sort, country })}`,
    fetchYearPage: rawYearPage
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
