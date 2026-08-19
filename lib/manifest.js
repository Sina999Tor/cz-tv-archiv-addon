const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1929 }, (_, i) => String(CURRENT_YEAR - i));

export const manifest = {
  id: 'cz.sk.tv.archive.all',
  version: '2.2.0',
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
