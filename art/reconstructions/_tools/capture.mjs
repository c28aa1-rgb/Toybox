// Capture review renders of an img2threejs factory through the Vite viewer page.
// Usage: node capture.mjs <model> <outDir> [name=az,el ...]
// Example: node capture.mjs blink renders/blockout ref=25,8 front=0,5 right=90,5 rear=180,5 left=270,5
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [model, outDir, ...views] = process.argv.slice(2);
if (!model || !outDir) {
  console.error('usage: node capture.mjs <model> <outDir> [name=az,el[,mode][,hide=a|b] ...]');
  process.exit(2);
}
const shots = views.length ? views : ['ref=25,8', 'front=0,5', 'right=90,5', 'rear=180,5', 'left=270,5'];
const base = process.env.VIEWER_URL ?? 'http://localhost:5173/viewer.html';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const shot of shots) {
  const [name, spec] = shot.split('=');
  const [az, el, mode = 'neutral', hide = ''] = spec.split(',');
  const match = name === 'ref' && process.env.MATCH ? `&match=${process.env.MATCH}` : '';
  const url = `${base}?model=${model}&az=${az}&el=${el}&mode=${mode}&size=1024${hide ? `&hide=${hide.replace(/\|/g, ',')}` : ''}${match}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 30000 });
  const err = await page.evaluate(() => window.__error);
  if (err) {
    console.error(`${name}: ${err}`);
    process.exitCode = 1;
    continue;
  }
  const file = join(outDir, `${name}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(file);
}
await browser.close();
