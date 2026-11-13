#!/usr/bin/env node
/**
 * render-board.mjs — Generates the 1500×1125 (3000×2250 @2x) 6-Panel Brand Kit Board
 * for Switchyard Lite directly from web/features/switchyard-lite/tokens.json and SVGs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = process.cwd()
const slug = 'switchyard-lite'
const tokensPath = path.join(root, 'web/features', slug, 'tokens.json')
const brandDir = path.join(root, 'web/public/brand', slug)
const htmlOut = path.join(brandDir, 'brandkit.html')
const outPath = path.join(brandDir, `${slug}-brandkit.png`)

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
const meta = tokens.meta || {}
const primitives = tokens.primitives || []
const contrast = tokens.contrast || []
const fails = contrast.filter((c) => !c.pass)
const passes = contrast.filter((c) => c.pass)

const ground = primitives.find((p) => p.name === 'ground')?.value || '#F1F4FB'
const plate = primitives.find((p) => p.name === 'plate')?.value || '#FFFFFF'
const well = primitives.find((p) => p.name === 'well')?.value || '#E4EAF7'
const ink = primitives.find((p) => p.name === 'ink')?.value || '#0D1526'
const accent = primitives.find((p) => p.name === 'accent')?.value || '#2F5BFF'

const readSvg = (file) => fs.existsSync(path.join(brandDir, file)) ? fs.readFileSync(path.join(brandDir, file), 'utf8') : ''
const markRevSvg = readSvg('mark-reverse.svg')
const lockupRevSvg = readSvg('lockup-reverse.svg')

const castDir = path.join(brandDir, 'cast')
const castItems = fs.readdirSync(castDir).filter((f) => f.endsWith('.svg')).map((f) => ({
  id: path.basename(f, '.svg'),
  svg: fs.readFileSync(path.join(castDir, f), 'utf8').replace(/width="64"\s+height="64"/, 'width="36" height="36"'),
}))

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1500px;
    height: 1125px;
    background: ${well};
    color: ${ink};
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    padding: 28px;
    -webkit-font-smoothing: antialiased;
  }
  #board {
    width: 1444px;
    height: 1069px;
    display: grid;
    grid-template-columns: 836px 588px;
    grid-template-rows: 576px 236px 217px;
    gap: 20px;
  }
  .panel {
    border-radius: 20px;
    overflow: hidden;
    position: relative;
    border: 1px solid #DCE3F4;
    background: ${ground};
    box-shadow: 0 2px 6px rgba(13,21,38,0.04);
  }
  .mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .p-hero {
    background:
      radial-gradient(ellipse 75% 60% at 80% 15%, rgba(47,91,255,0.22) 0%, transparent 65%),
      radial-gradient(ellipse 55% 50% at 15% 85%, rgba(255,139,106,0.16) 0%, transparent 65%),
      linear-gradient(to right, rgba(220,227,244,0.12) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(220,227,244,0.12) 1px, transparent 1px),
      ${ink};
    background-size: auto, auto, 32px 32px, 32px 32px;
    color: ${plate};
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 30px 34px;
  }
  .p-hero__top { display: flex; justify-content: space-between; opacity: 0.78; }
  .p-hero__title {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 44px;
    line-height: 1.02;
    letter-spacing: -0.035em;
    font-weight: 700;
    max-width: 18ch;
    margin: 16px 0 12px;
  }
  .p-hero__sub { font-size: 14px; line-height: 1.55; opacity: 0.84; max-width: 56ch; }
  .pill-strip {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 18px 0 6px;
  }
  .pill-demo {
    height: 36px;
    padding: 0 15px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .pill-prism {
    background: linear-gradient(128deg, #FF9A62 0%, #F264A8 36%, #6B5BFF 72%, #2F5BFF 100%);
    color: #fff;
    box-shadow: 0 8px 20px -6px rgba(107,91,255,0.55), inset 0 1px 0 rgba(255,255,255,0.35);
  }
  .pill-plate {
    background: #FFFFFF;
    color: #0D1526;
    box-shadow: 0 4px 12px rgba(0,0,0,0.16);
  }
  .pill-mint {
    background: #BCEFD4;
    color: #13794B;
  }
  .p-mark {
    background: ${ink};
    color: ${plate};
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .p-pal { padding: 20px 24px; display: flex; flex-direction: column; justify-content: space-between; background: ${plate}; }
  .p-pal__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
  .swatch { border-radius: 12px; overflow: hidden; border: 1px solid #DCE3F4; background: #fff; }
  .swatch__color { height: 102px; }
  .swatch__meta { padding: 8px 9px; }
  .swatch__name { font-size: 11px; font-weight: 700; display: block; color: ${ink}; }
  .swatch__hex { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #4A5878; }
  .p-type { padding: 20px 26px; display: flex; flex-direction: column; justify-content: space-between; background: ${plate}; }
  .p-cast { padding: 20px 24px; display: flex; flex-direction: column; justify-content: space-between; background: ${plate}; }
  .p-cast__grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; align-items: center; }
  .p-rules { background: ${ink}; color: ${plate}; padding: 18px 24px; display: flex; flex-direction: column; justify-content: space-between; }
  .p-rules ul { list-style: none; display: flex; flex-direction: column; gap: 7px; }
  .p-rules li { font-size: 11.25px; line-height: 1.38; opacity: 0.88; padding-left: 14px; position: relative; }
  .p-rules li::before { content: ''; position: absolute; left: 0; top: 5px; width: 6px; height: 6px; border-radius: 99px; background: ${accent}; }
</style>
</head>
<body>
  <div id="board">
    <div class="panel p-hero">
      <div class="p-hero__top">
        <span class="mono">BRAND KIT · V6.0 · SWITCHYARD-LITE</span>
        <span class="mono">PARAPET TURNOUT TRACK · 64 GRID</span>
      </div>
      <div class="p-hero__bottom">
        <div style="display:inline-flex;padding:10px 16px;border-radius:999px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);">
          <div style="height:34px;display:flex;align-items:center;">${lockupRevSvg}</div>
        </div>
        <div class="pill-strip">
          <span class="pill-demo pill-prism">✦ Ask AI</span>
          <span class="pill-demo pill-plate">Filter · <b style="color:#2F5BFF">2</b> ×</span>
          <span class="pill-demo pill-mint">● Online</span>
          <span class="pill-demo pill-plate" style="color:#2F5BFF">◌ In progress</span>
        </div>
        <h1 class="p-hero__title">Atmospheric Cloud Sky &amp; Tactile Pill Telemetry.</h1>
        <p class="p-hero__sub">${meta.oneSentence}</p>
      </div>
    </div>
    <div class="panel p-mark">
      <div style="display:flex;justify-content:space-between;opacity:0.6;" class="mono">
        <span>LOGO / 01 · TURNOUT SWITCH</span>
        <span style="text-align:right;">GRID 64×64<br/>GAP 6 UNITS</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;margin:auto 0;">
        <div style="transform:scale(1.38);">${lockupRevSvg || markRevSvg}</div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.14);padding-top:16px;display:flex;justify-content:space-between;align-items:flex-end;" class="mono">
        <span>64 · 32 · 16 COMPACT</span>
        <span>TWO OFFSET TRACKS + SIGNAL</span>
      </div>
    </div>
    <div class="panel p-pal">
      <div style="display:flex;justify-content:space-between;opacity:0.65;" class="mono">
        <span>PALETTE / ${primitives.length} PRIMITIVES</span>
        <span>${passes.length} PASS · ${fails.length} PUBLISHED FAILS</span>
      </div>
      <div class="p-pal__grid">
        ${primitives
          .slice(0, 7)
          .map(
            (p) => `<div class="swatch"><div class="swatch__color" style="background:${p.value};"></div><div class="swatch__meta"><span class="swatch__name">${p.name}</span><span class="swatch__hex">${p.value}</span></div></div>`
          )
          .join('')}
      </div>
    </div>
    <div class="panel p-type">
      <div style="display:flex;justify-content:space-between;opacity:0.65;" class="mono">
        <span>TYPE / 03 VOICES</span>
        <span>SPACE GROTESK · JAKARTA · JETBRAINS</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div><span class="mono" style="opacity:0.55;display:block;">DISPLAY · SPACE GROTESK 700</span><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:27px;letter-spacing:-0.03em;">Switchyard Lite · Aa 01</span></div>
        <div><span class="mono" style="opacity:0.55;display:block;">READING · PLUS JAKARTA SANS</span><span style="font-size:14.5px;color:#4A5878;">Porcelain capsule plates over an atmospheric periwinkle sky grid.</span></div>
        <div><span class="mono" style="opacity:0.55;display:block;">MONO · JETBRAINS MONO</span><span class="mono" style="font-size:12.5px;color:${accent};">sy/T-104 · 30 mins · ΔE_OK 0.061</span></div>
      </div>
    </div>
    <div class="panel p-cast">
      <div style="display:flex;justify-content:space-between;opacity:0.65;" class="mono">
        <span>CAST / 06 OPERATIONAL NOUNS</span>
        <span>64-UNIT GRID · FILL ONLY</span>
      </div>
      <div class="p-cast__grid">
        ${castItems
          .map(
            (c) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;"><div style="width:36px;height:36px;display:grid;place-items:center;">${c.svg}</div><span class="mono">${c.id}</span></div>`
          )
          .join('')}
      </div>
    </div>
    <div class="panel p-rules">
      <div style="display:flex;justify-content:space-between;opacity:0.5;" class="mono">
        <span>ARCHITECTURAL LAWS</span>
        <span>GATE V6.0</span>
      </div>
      <ul>
        <li><b>Capsule Control Law.</b> Buttons, selects, filters, and status badges share a 999px capsule radius.</li>
        <li><b>Separate 16px Compact.</b> Below 24px the turnout switch drops its signal dot and thickens to 15u.</li>
        <li><b>Honest Contrast Ledger.</b> 3 failing pairs (muted, coral, mint) are published and graphic-only.</li>
        <li><b>Double-Framed Stage.</b> App shell sits inside an outer frosted bezel on the 32px blueprint sky.</li>
      </ul>
      <div style="display:flex;justify-content:space-between;opacity:0.45;" class="mono">
        <span>SWITCHYARD LITE</span>
        <span>SUNNYSIDE ENGINE V6.0</span>
      </div>
    </div>
  </div>
</body>
</html>`

fs.writeFileSync(htmlOut, html, 'utf8')

const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  path.join(process.env.HOME, '.workbuddy-ai/cache/pw/node_modules/playwright'),
  'playwright',
].filter(Boolean)

let chromium
for (const cand of PW_CANDIDATES) {
  try {
    const req = createRequire(import.meta.url)
    ;({ chromium } = req(cand))
    break
  } catch {}
}
if (!chromium) throw new Error('playwright not found')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1500, height: 1125 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
})
await page.goto(pathToFileURL(path.resolve(htmlOut)).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(250)
await page.locator('body').screenshot({ path: path.resolve(outPath) })
await browser.close()
console.log(`Rendered 6-panel brandkit board → ${outPath} (3000 × 2250)`)
