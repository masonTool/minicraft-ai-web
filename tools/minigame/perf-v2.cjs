const { chromium } = require('playwright');

const URL = process.env.V2_URL || 'http://localhost:3847/';
const STRICT = process.env.PERF_STRICT === '1';
const HEADFUL = process.env.PERF_HEADFUL === '1';
const CHROME =
  process.env.CHROME_PATH ||
  '/Users/mason/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

async function main() {
  console.log('[perf] launching browser');
  const browser = await chromium.launch({
    headless: !HEADFUL,
    executablePath: CHROME,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1080, height: 700 }, hasTouch: true });
  const page = await context.newPage();
  let latest = null;
  page.on('console', (message) => {
    const text = message.text();
    const index = text.indexOf('[V2] ');
    if (index < 0) return;
    try {
      latest = JSON.parse(text.slice(index + 5));
    } catch {
      // 忽略非状态日志
    }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('[perf] page ready');
  await page.waitForTimeout(2000);
  const frame = await page.locator('iframe').boundingBox();
  if (!frame) throw new Error('找不到游戏 iframe');
  const designHeight = (1024 * 390) / 844;
  const tap = async (x, y) =>
    page.touchscreen.tap(
      frame.x + (x / 1024) * frame.width,
      frame.y + (y / designHeight) * frame.height,
    );

  console.log('[perf] creating world');
  await tap(512, 327);
  await page.waitForTimeout(400);
  await tap(512, 216);
  await page.waitForTimeout(400);
  await tap(727, 423);
  const readyStarted = Date.now();
  while (Date.now() - readyStarted < 20000 && (!latest || (Number(latest.drawn) || 0) < 20)) {
    await page.waitForTimeout(250);
  }
  console.log('[perf] sampling 6s');
  await page.waitForTimeout(6000);

  if (!latest) throw new Error('没有收到 [V2] 状态');
  const fps = Number(latest.fps) || 0;
  const quality = Number(latest.qualityTier);
  const drawn = Number(latest.drawn) || 0;
  console.log(
    'PERF',
    JSON.stringify({
      fps,
      qualityTier: quality,
      chunks: latest.chunks,
      drawn,
      meshBackend: latest.meshBackend,
    }),
  );
  if (STRICT && fps < 50) throw new Error(`FPS 过低: ${fps}`);
  if (quality < 1) throw new Error(`画质误降到 ${quality}`);
  if (drawn <= 0) throw new Error('没有绘制区块');
  if (!latest.meshBackend) throw new Error('缺少 meshBackend');
  if (!STRICT) {
    console.log('[perf] headless 软渲染 FPS 仅作参考，真机请用 PERF_STRICT=1 PERF_HEADFUL=1');
  }

  await browser.close();
}

main().catch((error) => {
  console.error('PERF FAIL', error.message);
  process.exitCode = 1;
});
