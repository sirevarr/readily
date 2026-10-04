/* Readily v2 — Búsqueda Web Rápida sin salir de la lectura (Wikipedia / Wikcionario / DuckDuckGo) */

export async function quickWebLookup(term) {
  const clean = String(term || '').trim();
  if (!clean) throw new Error('Término de búsqueda vacío.');

  // 1. Wikipedia REST API (Español)
  try {
    const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.type === 'standard' && data.extract) {
        return {
          source: 'Wikipedia',
          term: data.title || clean,
          definition: data.extract,
          description: data.description || '',
          url: data.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(clean)}`
        };
      }
    }
  } catch (_) {}

  // 2. Wikcionario API (Español)
  try {
    const res = await fetch(`https://es.wiktionary.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(clean)}&format=json&origin=*`);
    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.pages || {};
      const page = Object.values(pages)[0];
      if (page && page.extract && !page.missing) {
        const lines = page.extract
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('=='))
          .slice(0, 3)
          .join(' ');
        if (lines) {
          return {
            source: 'Wikcionario',
            term: page.title || clean,
            definition: lines,
            description: 'Diccionario libre',
            url: `https://es.wiktionary.org/wiki/${encodeURIComponent(clean)}`
          };
        }
      }
    }
  } catch (_) {}

  // 3. DuckDuckGo Instant Answer API
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(clean)}&format=json&no_html=1&skip_disambig=1`);
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) {
        return {
          source: 'DuckDuckGo',
          term: data.Heading || clean,
          definition: data.AbstractText,
          description: data.AbstractSource || 'Consulta web',
          url: data.AbstractURL || ''
        };
      }
    }
  } catch (_) {}

  throw new Error(`No se encontró una definición rápida en la web para "${clean}".`);
}
