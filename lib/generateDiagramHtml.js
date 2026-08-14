// lib/generateDiagramHtml.js
//
// Generates a standalone diagram.html that embeds the Mermaid source directly.
// The file renders without the app running -- it loads Mermaid from CDN and
// inlines the diagram definition as a data attribute.

function buildDiagramHtml(spec, mermaidSrc) {
  const nc = spec.nestedCluster || {};
  const physHosts = spec.physicalHosts || [spec.physicalHost];
  const title = `${nc.clusterName || 'Lab'} Network Diagram`;
  const subtitle = [
    nc.hostCount ? `${nc.hostCount} nested hosts` : null,
    physHosts.length > 1 ? `${physHosts.length} physical hosts` : null,
    spec.esxiVersion?.label || null
  ].filter(Boolean).join(' · ');

  // Escape the mermaid source for embedding in a JS string literal
  const escapedSrc = JSON.stringify(mermaidSrc);

  // Offline fallback: mermaid.live URL with pre-encoded payload
  const livePayload = Buffer.from(JSON.stringify({ code: mermaidSrc, mermaid: { theme: 'dark' } })).toString('base64');
  const liveUrl = `https://mermaid.live/edit#base64:${livePayload}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(title)}</title>
<style>
  :root {
    --bg: #0e1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --text-faint: #484f58;
    --accent: #58a6ff; --accent-soft: rgba(88,166,255,0.08);
    --radius: 6px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
    display: flex; flex-direction: column;
  }
  .header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 12px 20px; display: flex; align-items: center; gap: 12px;
    flex-shrink: 0;
  }
  .header h1 { font-size: 15px; font-weight: 600; }
  .header-sub { font-size: 12px; color: var(--text-dim); }
  .toolbar {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 8px 20px; display: flex; gap: 8px; align-items: center; flex-shrink: 0;
  }
  .btn {
    font-size: 12px; font-family: inherit; padding: 5px 12px;
    border-radius: var(--radius); border: 1px solid var(--border);
    background: transparent; color: var(--text-dim); cursor: pointer;
    transition: all .15s;
  }
  .btn:hover { color: var(--text); border-color: var(--text-dim); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600; }
  .btn-primary:hover { filter: brightness(1.1); color: #0d1117; border-color: var(--accent); }
  .zoom-display { font-size: 12px; color: var(--text-dim); min-width: 40px; text-align: center; font-family: monospace; }
  .canvas-wrap {
    flex: 1; overflow: hidden; position: relative; cursor: grab;
  }
  .canvas-wrap.grabbing { cursor: grabbing; }
  .diagram-inner { position: absolute; transform-origin: 0 0; user-select: none; }
  .diagram-inner svg { display: block; max-width: none; }
  .loading {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: var(--text-faint); font-size: 14px;
  }
  .statusbar {
    background: var(--surface); border-top: 1px solid var(--border);
    padding: 4px 16px; font-size: 11px; color: var(--text-faint); flex-shrink: 0;
  }
  .legend {
    position: absolute; bottom: 16px; right: 16px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px; font-size: 12px; z-index: 10; display: none;
  }
  .legend-title { font-weight: 600; color: var(--text-dim); margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; color: var(--text-dim); }
  .legend-line { width: 26px; height: 2px; flex-shrink: 0; }
  .legend-line.solid { background: var(--text-faint); }
  .legend-line.dashed { background: repeating-linear-gradient(90deg, var(--text-faint) 0, var(--text-faint) 4px, transparent 4px, transparent 8px); }
  .offline-msg {
    position: absolute; inset: 0; display: none; flex-direction: column;
    align-items: center; justify-content: center; padding: 32px; gap: 16px;
  }
  .offline-msg p { font-size: 14px; color: var(--text-dim); text-align: center; }
  .offline-msg a { color: var(--accent); }
  .offline-msg pre {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px; font-size: 11px; color: var(--text-dim); white-space: pre-wrap;
    word-break: break-all; max-height: 60vh; overflow-y: auto; width: 100%; max-width: 800px;
  }
</style>
</head>
<body>
<div class="header">
  <h1>${escHtml(title)}</h1>
  ${subtitle ? `<span class="header-sub">${escHtml(subtitle)}</span>` : ''}
</div>
<div class="toolbar">
  <button class="btn" id="btn-zoom-out">&#x2212;</button>
  <span class="zoom-display" id="zoom-display">100%</span>
  <button class="btn" id="btn-zoom-in">+</button>
  <button class="btn" id="btn-fit">Fit</button>
  <button class="btn btn-primary" id="btn-svg" style="margin-left:auto">Download SVG</button>
</div>
<div class="canvas-wrap" id="canvas-wrap">
  <div class="diagram-inner" id="diagram-inner"></div>
  <div class="loading" id="loading">Rendering diagram&hellip;</div>
  <div class="offline-msg" id="offline-msg">
    <p>Mermaid could not be loaded from CDN. Paste the source below into <a href="${escHtml(liveUrl)}" target="_blank" rel="noopener noreferrer">mermaid.live</a> to view the diagram online.</p>
    <pre>${escHtml(mermaidSrc)}</pre>
  </div>
  <div class="legend" id="legend">
    <div class="legend-title">Key</div>
    <div class="legend-item"><div class="legend-line solid"></div>Managed / routed</div>
    <div class="legend-item"><div class="legend-line dashed"></div>Same-segment / hosted</div>
  </div>
</div>
<div class="statusbar" id="statusbar">Loading&hellip;</div>

<script src="https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js" integrity="sha384-yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF" crossorigin="anonymous" onerror="document.getElementById('loading').style.display='none';var m=document.getElementById('offline-msg');m.style.display='flex';"></script>
<script>
'use strict';
const MERMAID_SRC = ${escapedSrc};
const SPEC = ${JSON.stringify({ nestedCluster: nc, physicalHosts: physHosts, esxiVersion: spec.esxiVersion })};

if (typeof mermaid !== 'undefined') {
  // htmlLabels: false -- matches public/wizard.js and public/diagram.html. Keeps
  // multi-line node labels as SVG <tspan> line breaks instead of an HTML <br> inside
  // a foreignObject (mermaid doesn't self-close that <br>, which is invalid XML) so
  // the exported SVG stays well-formed if opened directly in a browser or another tool.
  mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true, securityLevel: 'strict', flowchart: { htmlLabels: false } });
}

let scale = 1, offsetX = 0, offsetY = 0;
let dragging = false, dsx = 0, dsy = 0, dox = 0, doy = 0;
let renderedSvg = null;

const canvasWrap   = document.getElementById('canvas-wrap');
const diagInner    = document.getElementById('diagram-inner');
const loading      = document.getElementById('loading');
const legend       = document.getElementById('legend');
const zoomDisplay  = document.getElementById('zoom-display');
const statusbar    = document.getElementById('statusbar');

function applyTransform() {
  diagInner.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + scale + ')';
  zoomDisplay.textContent = Math.round(scale * 100) + '%';
}

function fitToWindow() {
  const svgEl = diagInner.querySelector('svg');
  if (!svgEl) return;
  const cw = canvasWrap.clientWidth, ch = canvasWrap.clientHeight;
  const sw = svgEl.scrollWidth || 800, sh = svgEl.scrollHeight || 600;
  scale = Math.min(cw / sw, ch / sh, 1.5) * 0.9;
  offsetX = (cw - sw * scale) / 2;
  offsetY = (ch - sh * scale) / 2;
  applyTransform();
}

// Self-close any bare void HTML tag (<br>, <img>, <hr>, <input>, <meta>, <link>) left in
// a Mermaid-rendered SVG string -- valid loose HTML, invalid XML. Download SVG / opening
// the file directly parses it with a strict XML parser, so a malformed file fails to
// render at all. Idempotent.
function fixSvgVoidTags(svgStr) {
  return svgStr.replace(/<(br|img|hr|input|meta|link)((?:\s[^>]*)?)\/?>/gi, (m, tag, attrs) => {
    const cleanAttrs = attrs.replace(/\/\s*$/, '');
    return '<' + tag + cleanAttrs + '/>';
  });
}

(async function init() {
  if (typeof mermaid === 'undefined') return;
  try {
    let { svg } = await mermaid.render('diag', MERMAID_SRC);
    svg = fixSvgVoidTags(svg);
    renderedSvg = svg;
    diagInner.innerHTML = svg;
    const svgEl = diagInner.querySelector('svg');
    if (svgEl) { svgEl.removeAttribute('width'); svgEl.removeAttribute('height'); }
    loading.style.display = 'none';
    legend.style.display = '';
    fitToWindow();
    const nc = SPEC.nestedCluster || {};
    const ph = (SPEC.physicalHosts || []).length;
    statusbar.textContent = (nc.hostCount || 0) + ' nested hosts \xb7 ' + ph + ' physical host' + (ph !== 1 ? 's' : '') + ' \xb7 ' + (SPEC.esxiVersion && SPEC.esxiVersion.label || '');
  } catch(e) {
    loading.textContent = 'Render error: ' + e.message;
    statusbar.textContent = 'Error';
  }
})();

document.getElementById('btn-zoom-in').onclick  = () => { scale = Math.min(scale * 1.25, 5); applyTransform(); };
document.getElementById('btn-zoom-out').onclick = () => { scale = Math.max(scale / 1.25, 0.1); applyTransform(); };
document.getElementById('btn-fit').onclick       = fitToWindow;

canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvasWrap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const f = e.deltaY < 0 ? 1.1 : 0.9, ns = Math.max(0.1, Math.min(5, scale * f));
  offsetX = mx - (mx - offsetX) * (ns / scale);
  offsetY = my - (my - offsetY) * (ns / scale);
  scale = ns; applyTransform();
}, { passive: false });

canvasWrap.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true; dsx = e.clientX; dsy = e.clientY; dox = offsetX; doy = offsetY;
  canvasWrap.classList.add('grabbing');
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  offsetX = dox + (e.clientX - dsx); offsetY = doy + (e.clientY - dsy); applyTransform();
});
window.addEventListener('mouseup', () => { dragging = false; canvasWrap.classList.remove('grabbing'); });

document.getElementById('btn-svg').onclick = () => {
  if (!renderedSvg) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([renderedSvg], { type: 'image/svg+xml' }));
  a.download = 'network-diagram.svg';
  a.click();
};
</script>
</body>
</html>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildDiagramHtml };
