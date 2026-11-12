/**
 * lib/screenshot.js
 * ─────────────────
 * Tira o print de um site (capa dos projetos do portfólio). Chromium do
 * sistema via puppeteer-core — no container vem do `apk add chromium`
 * (Dockerfile), no Mac usa o Chrome instalado. Mesma lista de caminhos do
 * gerador de PDF antigo.
 *
 * Browser fica aberto entre capturas e fecha sozinho depois de 90s parado,
 * pra não segurar ~150MB de RAM à toa no server principal.
 */
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CANDIDATOS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  // Windows: o Edge vem em toda máquina, inclusive as do trabalho sem Chrome
  ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => process.env[v] ? [
    `${process.env[v]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env[v]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ] : []),
].filter(Boolean);

function acharChromium() {
  for (const p of CANDIDATOS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

let browserPromise = null;
let timerFechar = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  const executablePath = acharChromium();
  if (!executablePath) throw new Error("chromium_ausente");
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // /dev/shm do docker tem 64MB; sem isso o Chromium cai em página pesada
      "--disable-gpu", "--hide-scrollbars", "--font-render-hinting=none",
    ],
  });
  try {
    const b = await browserPromise;
    b.on("disconnected", () => { browserPromise = null; });
    return b;
  } catch (e) {
    browserPromise = null;
    throw e;
  }
}

function agendarFechar() {
  clearTimeout(timerFechar);
  timerFechar = setTimeout(async () => {
    const p = browserPromise; browserPromise = null;
    try { (await p)?.close(); } catch {}
  }, 90_000);
  timerFechar.unref?.();
}

/**
 * capturar(url, { largura, altura, mobile }) → { data: Buffer, mime, w, h }
 * Desktop 1440×900 por padrão. JPEG q82: ~150–300KB, cabe folgado no Mongo.
 * mobile:true = iPhone 390×844 @2x (o site do cliente em layout de celular),
 * usado no painel da home quando a tela é pequena.
 */
async function capturar(url, opts = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("url_invalida");
  const mobile = !!opts.mobile;
  const largura = opts.largura || (mobile ? 390 : 1440);
  const altura = opts.altura || (mobile ? 844 : 900);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: largura, height: altura, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await page.setUserAgent(mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 NomadeBusinessBot/1.0"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NomadeBusinessBot/1.0");
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5" }); // site do cliente em PT, não na versão EN
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(u.href, { waitUntil: "networkidle2", timeout: 30_000 });
    // deixa hero/animação de entrada assentar e fontes carregarem
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const data = await page.screenshot({ type: "jpeg", quality: 82, fullPage: false });
    return { data, mime: "image/jpeg", w: largura * (mobile ? 2 : 1), h: altura * (mobile ? 2 : 1) };
  } finally {
    try { await page.close(); } catch {}
    agendarFechar();
  }
}

module.exports = { capturar, acharChromium };
