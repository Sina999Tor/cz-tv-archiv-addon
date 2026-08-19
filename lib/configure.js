export function configurePageHtml() {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CZ/SK Filmy a Seriály — instalace doplňku</title>
<style>
  :root {
    --bg: #0f1115;
    --card: #171a21;
    --border: #262b36;
    --text: #e8eaed;
    --muted: #9aa1ac;
    --accent: #4f8cff;
    --accent-hover: #3d78ea;
    --ok: #33c17a;
    --err: #ff6767;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(circle at top, #1a1d25, var(--bg) 60%);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 520px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  h1 {
    font-size: 22px;
    margin: 0 0 6px;
  }
  p.subtitle {
    color: var(--muted);
    margin: 0 0 28px;
    font-size: 14px;
    line-height: 1.5;
  }
  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--muted);
  }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 12px 14px;
    background: #0f1115;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    border-color: var(--accent);
  }
  .key-row {
    position: relative;
    margin-bottom: 20px;
  }
  .toggle-visibility {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    padding: 6px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
    margin: -12px 0 20px;
    line-height: 1.5;
  }
  .hint a { color: var(--accent); text-decoration: none; }
  .hint a:hover { text-decoration: underline; }
  button.primary {
    width: 100%;
    padding: 13px;
    background: var(--accent);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  button.primary:hover { background: var(--accent-hover); }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }

  #result {
    margin-top: 28px;
    display: none;
  }
  #result.visible { display: block; }

  .field-block {
    margin-bottom: 16px;
  }
  .field-block label {
    margin-bottom: 6px;
  }
  .url-row {
    display: flex;
    gap: 8px;
  }
  .url-row input {
    flex: 1;
    font-size: 12px;
    color: var(--muted);
    background: #0b0d11;
  }
  .copy-btn {
    flex-shrink: 0;
    padding: 0 16px;
    background: #232733;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .copy-btn:hover { background: #2b3040; }
  .copy-btn.copied { background: var(--ok); color: #0f1115; border-color: var(--ok); }

  .install-btn {
    display: block;
    text-align: center;
    width: 100%;
    padding: 13px;
    margin-top: 4px;
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 10px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
  }
  .install-btn:hover { background: rgba(79,140,255,0.1); }

  .error {
    color: var(--err);
    font-size: 13px;
    margin-top: 8px;
    display: none;
  }
  .error.visible { display: block; }

  footer {
    margin-top: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
  }
</style>
</head>
<body>
  <div class="card">
    <h1>🎬 CZ/SK Filmy a Seriály</h1>
    <p class="subtitle">Doplněk pro Stremio / Nuvio se streamy přes Torrentio. Zadej svůj vlastní TMDB API klíč a vygeneruj si instalační odkaz — klíč se ukládá pouze v samotné URL adrese doplňku, nikde jinde se neukládá.</p>

    <div class="key-row">
      <label for="tmdbKey">TMDB API klíč</label>
      <input type="password" id="tmdbKey" placeholder="např. 3f8a1c9d2e..." autocomplete="off" spellcheck="false">
      <button class="toggle-visibility" type="button" onclick="toggleKeyVisibility()">Zobrazit</button>
    </div>
    <p class="hint">Klíč zdarma získáš na <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a> (sekce API, typ &quot;API Read Access Token&quot; nebo klasický &quot;API Key&quot;).</p>

    <button class="primary" onclick="generateLink()">Vygenerovat instalační odkaz</button>
    <div class="error" id="error">Zadej prosím TMDB API klíč.</div>

    <div id="result">
      <div class="field-block">
        <label>Adresa manifestu (pro Stremio / Nuvio)</label>
        <div class="url-row">
          <input type="text" id="manifestUrl" readonly>
          <button class="copy-btn" id="copyBtn" onclick="copyToClipboard()">Kopírovat</button>
        </div>
      </div>
      <a class="install-btn" id="installLink" href="#">Nainstalovat přímo do Stremio</a>
    </div>

    <footer>Klíč se nikde na serveru neukládá — je zakódovaný přímo v instalační URL.</footer>
  </div>

<script>
function toggleKeyVisibility() {
  const input = document.getElementById('tmdbKey');
  const btn = document.querySelector('.toggle-visibility');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Skrýt';
  } else {
    input.type = 'password';
    btn.textContent = 'Zobrazit';
  }
}

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function generateLink() {
  const key = document.getElementById('tmdbKey').value.trim();
  const errorEl = document.getElementById('error');
  const resultEl = document.getElementById('result');

  if (!key) {
    errorEl.classList.add('visible');
    resultEl.classList.remove('visible');
    return;
  }
  errorEl.classList.remove('visible');

  const config = toBase64Url(JSON.stringify({ tmdb: key }));
  const origin = window.location.origin;
  const host = window.location.host;
  const manifestUrl = origin + '/' + config + '/manifest.json';
  const stremioLink = 'stremio://' + host + '/' + config + '/manifest.json';

  document.getElementById('manifestUrl').value = manifestUrl;
  document.getElementById('installLink').href = stremioLink;
  resultEl.classList.add('visible');
}

function copyToClipboard() {
  const input = document.getElementById('manifestUrl');
  input.select();
  input.setSelectionRange(0, 99999);

  const btn = document.getElementById('copyBtn');
  const done = () => {
    btn.textContent = 'Zkopírováno ✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Kopírovat';
      btn.classList.remove('copied');
    }, 1800);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(done).catch(() => {
      document.execCommand('copy');
      done();
    });
  } else {
    document.execCommand('copy');
    done();
  }
}

document.getElementById('tmdbKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generateLink();
});
</script>
</body>
</html>`;
}
