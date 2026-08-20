const SORT_OPTIONS = ['Populární', 'Oblíbené', 'Nejlépe hodnocené', 'Nejčastěji navštěvované', 'Vše'];
const COUNTRY_OPTIONS = ['CZ + SK', 'Pouze CZ', 'Pouze SK', 'Vše'];

export const manifest = {
  id: 'cz.sk.tv.archive.all',
  version: '3.4.0',
  name: 'CZ/SK Filmy a Seriály',
  description: 'České a slovenské filmy a seriály (a volitelně i ostatní) — katalog z TMDB. Streamy řeší jiné nainstalované addony (Webshare, Hellspy, ...).',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:'],
  catalogs: [
    {
      type: 'movie',
      id: 'cz_movies',
      name: 'CZ/SK Filmy',
      extra: [
        { name: 'sort', options: SORT_OPTIONS, isRequired: false },
        { name: 'country', options: COUNTRY_OPTIONS, isRequired: false },
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'cz_series',
      name: 'CZ/SK Seriály',
      extra: [
        { name: 'sort', options: SORT_OPTIONS, isRequired: false },
        { name: 'country', options: COUNTRY_OPTIONS, isRequired: false },
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ]
};

// Manifest vrácený na /manifest.json BEZ konfiguračního TMDB klíče v cestě.
// Řekne Stremiu/Nuviu, že je potřeba addon nejdřív nakonfigurovat (přes /configure).
export function unconfiguredManifest() {
  return {
    ...manifest,
    behaviorHints: {
      ...(manifest.behaviorHints || {}),
      configurable: true,
      configurationRequired: true
    }
  };
}

// Manifest vrácený, když už je v URL platný TMDB klíč (base64 config segment).
export function configuredManifest() {
  return {
    ...manifest,
    behaviorHints: {
      ...(manifest.behaviorHints || {}),
      configurable: true,
      configurationRequired: false
    }
  };
}
