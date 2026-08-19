// Konfigurace (TMDB klíč) se posílá jako první segment URL, base64url-zakódovaný
// JSON. Tenhle segment vygeneruje /configure stránka a Stremio/Nuvio ho pak
// automaticky posílá před každý požadavek (manifest, catalog, meta, stream),
// protože base URL addonu = adresář, ve kterém leží manifest.json.

export function decodeConfig(segment) {
  if (!segment) return null;
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    if (obj && typeof obj.tmdb === 'string' && obj.tmdb.trim()) {
      return obj.tmdb.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveApiKey(segment) {
  return decodeConfig(segment) || process.env.TMDB_API_KEY || null;
}
