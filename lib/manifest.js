export const manifest = {
  id: 'cz.sk.tv.archive.all',
  version: '1.0.0',
  name: 'CZ TV Archívy (ČT, Prima, Nova)',
  description: 'Kompletní archív ČT iVysílání, iPrima a TV Nova včetně sezón a epizod.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  idPrefixes: ['ct:', 'prima:', 'nova:'],
  catalogs: [
    {
      type: 'series',
      id: 'cz_tv_archive',
      name: 'CZ TV Archív',
      extra: [
        {
          name: 'genre',
          options: ['Vše', 'Česká Televize', 'iPrima', 'Nova'],
          isRequired: false
        },
        {
          name: 'search',
          isRequired: false
        }
      ]
    }
  ]
};
