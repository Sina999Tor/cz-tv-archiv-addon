const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1929 }, (_, i) => String(CURRENT_YEAR - i));

export const manifest = {
  id: 'cz.sk.tv.archive.all',
  version: '2.3.0',
  name: 'CZ/SK Filmy a Seriály',
  description: 'České a slovenské filmy a seriály — katalog z TMDB, streamy přes Torrentio.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    {
      type: 'movie',
      id: 'cz_movies',
      name: 'CZ/SK Filmy',
      extra: [
        { name: 'genre', options: ['Populární', 'Nejlépe hodnocené', 'Novinky'], isRequired: false },
        { name: 'country', options: ['CZ + SK', 'Pouze CZ', 'Pouze SK'], isRequired: false },
        { name: 'year', options: YEAR_OPTIONS, isRequired: false },
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'cz_series',
      name: 'CZ/SK Seriály',
      extra: [
        { name: 'genre', options: ['Populární', 'Nejlépe hodnocené', 'Novinky'], isRequired: false },
        { name: 'country', options: ['CZ + SK', 'Pouze CZ', 'Pouze SK'], isRequired: false },
        { name: 'year', options: YEAR_OPTIONS, isRequired: false },
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
