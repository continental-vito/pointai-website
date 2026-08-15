const { chromium } = require('playwright');

const MARK = `<path d="M 24.14 18.79 L 24.14 18.79 A 3.02 3.02 0 0 1 28.72 15.48 L 71.10 43.73 L 71.10 43.73 A 6.01 6.01 0 0 1 70.85 53.89 L 47.15 68.11 L 47.15 68.11 A 7.21 7.21 0 0 1 36.49 63.84 L 24.14 18.79 Z"/><path d="M 66.00 79.00 a 12.00 12.00 0 1 1 24.00 0 a 12.00 12.00 0 1 1 -24.00 0 Z"/>`;

// mark bbox is 66 x 76.05 (ratio 0.868). markScale = mark height as a fraction of the tile.
function page(size, radiusPct, markScale, bg) {
  const h = size * markScale, w = h * (66 / 76.05);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  html,body{width:${size}px;height:${size}px;background:transparent}
  .tile{width:${size}px;height:${size}px;background:${bg};
        border-radius:${(size * radiusPct / 100).toFixed(2)}px;
        display:flex;align-items:center;justify-content:center}
  svg{width:${w.toFixed(3)}px;height:${h.toFixed(3)}px;display:block}
  </style></head><body>
  <div class="tile"><svg viewBox="0 0 66 76.05" xmlns="http://www.w3.org/2000/svg">
    <g fill="#FFFFFF" transform="translate(-24 -14.95)">${MARK}</g></svg></div>
  </body></html>`;
}

const JOBS = [
  // small: tighter radius, bigger mark — a squircle turns to mush at 16px
  { file: 'favicon-16.png',  size: 16,  radius: 18, mark: 0.74, bg: '#0B0B0C' },
  { file: 'favicon-32.png',  size: 32,  radius: 18, mark: 0.70, bg: '#0B0B0C' },
  { file: 'favicon-48.png',  size: 48,  radius: 19, mark: 0.66, bg: '#0B0B0C' },
  { file: 'icon-192.png',    size: 192, radius: 22, mark: 0.58, bg: '#0B0B0C' },
  { file: 'icon-512.png',    size: 512, radius: 22, mark: 0.58, bg: '#0B0B0C' },
  // apple-touch-icon: iOS applies its own mask and renders black behind alpha,
  // so this one is a full opaque square with no rounding of its own.
  { file: 'apple-touch-icon.png', size: 180, radius: 0, mark: 0.56, bg: '#0B0B0C' },
  // maskable: mark inside the centre 80% safe circle
  { file: 'icon-512-maskable.png', size: 512, radius: 0, mark: 0.46, bg: '#0B0B0C' },
];

(async () => {
  const b = await chromium.launch();
  for (const j of JOBS) {
    const p = await b.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await p.setContent(page(j.size, j.radius, j.mark, j.bg));
    await p.screenshot({ path: '/home/claude/icons/' + j.file, omitBackground: true });
    await p.close();
    console.log('rendered', j.file, j.size + 'px');
  }
  await b.close();
})();
