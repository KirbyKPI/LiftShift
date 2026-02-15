import puppeteer, { type Browser, type Page } from 'puppeteer';

const HEVY_LOGIN_URL = 'https://hevy.com/login';
const RECAPTCHA_SITE_KEY = '6LfkQG0jAAAAANTrIkVXKPfSPHyJnt4hYPWqxh0R';
const RECAPTCHA_TIMEOUT_MS = 120_000;
const BROWSER_MAX_AGE_MS = 30 * 60 * 1000;
const BROWSER_MAX_USE_COUNT = 100;
const IDLE_CLOSE_MS = 10 * 60 * 1000;
const MAX_PAGES = 1;
const TOKEN_CACHE_DURATION_MS = 100_000;

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

type RecaptchaContext = {
  traceId?: string;
};

let browserInitInFlight: Promise<void> | null = null;
let browser: Browser | null = null;
let browserCreatedAt = 0;
let browserUseCount = 0;
let standbyPage: Page | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
const openPages = new Set<Page>();
const activePages = new Set<Page>();
const pageWaiters: Array<() => void> = [];
let pageCreationReservations = 0;
let sessionWarmupInFlight: Promise<void> | null = null;

const now = (): number => Date.now();

const isTokenCacheValid = (): boolean => {
  if (!tokenCache) return false;
  return Date.now() < tokenCache.expiresAt;
};

const setTokenCache = (token: string): void => {
  tokenCache = {
    token,
    expiresAt: Date.now() + TOKEN_CACHE_DURATION_MS,
  };
};

const clearTokenCacheInternal = (): void => {
  tokenCache = null;
};

const getTracePrefix = (traceId?: string): string =>
  traceId ? `[System][${traceId}]` : '[System]';

const safeErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const clearIdleCloseTimer = (): void => {
  if (!idleCloseTimer) return;
  clearTimeout(idleCloseTimer);
  idleCloseTimer = null;
};

const scheduleIdleClose = (traceId?: string): void => {
  clearIdleCloseTimer();
  if (!browser) return;
  if (!Number.isFinite(IDLE_CLOSE_MS) || IDLE_CLOSE_MS <= 0) return;
  if (activePages.size > 0) return;

  const prefix = getTracePrefix(traceId);
  idleCloseTimer = setTimeout(() => {
    void closeBrowser('idle_timeout', traceId).catch((err) => {
      console.warn(`${prefix} Failed idle close:`, safeErrorMessage(err));
    });
  }, IDLE_CLOSE_MS);
  idleCloseTimer.unref();
};


const launchBrowser = async (): Promise<Browser> => {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-sync',
    ],
  };
  const browser = await puppeteer.launch(launchOptions);
  return browser;
};

const isPageClosed = (p: Page | null): boolean => {
  if (!p) return true;
  try {
    return p.isClosed();
  } catch {
    return true;
  }
};

const closePage = async (p: Page, reason: string, traceId?: string): Promise<void> => {
  const prefix = getTracePrefix(traceId);
  openPages.delete(p);
  activePages.delete(p);
  if (standbyPage === p) standbyPage = null;
  if (!isPageClosed(p)) {
    try {
      await p.close();
    } catch (err) {
      console.warn(`${prefix} Failed to close page during ${reason}:`, safeErrorMessage(err));
    }
  }
};

const closeBrowser = async (reason: string, traceId?: string): Promise<void> => {
  const prefix = getTracePrefix(traceId);
  console.log(`${prefix} 🛑 Browser closing (${reason})`);
  clearIdleCloseTimer();
  const activeBrowser = browser;
  const pages = Array.from(openPages);

  openPages.clear();
  activePages.clear();
  standbyPage = null;
  browser = null;
  browserCreatedAt = 0;
  browserUseCount = 0;
  pageCreationReservations = 0;

  for (const p of pages) {
    await closePage(p, reason, traceId);
  }

  if (activeBrowser) {
    try {
      await activeBrowser.close();
      console.log(`${prefix} ✅ Browser closed`);
    } catch (err) {
      console.warn(`${prefix} ❌ Failed to close browser:`, safeErrorMessage(err));
    }
  }

  while (pageWaiters.length > 0) {
    const waiter = pageWaiters.shift();
    if (waiter) waiter();
  }
};

const needsBrowserRecycle = (): boolean => {
  if (!browser) return false;
  if (browserUseCount >= BROWSER_MAX_USE_COUNT) return true;
  if (browserCreatedAt === 0) return true;
  return now() - browserCreatedAt >= BROWSER_MAX_AGE_MS;
};

const ensureRecaptchaLoaded = async (p: Page, traceId?: string, forceReload = false): Promise<void> => {
  const prefix = getTracePrefix(traceId);
  const ready = await p.evaluate(() => Boolean((window as any).grecaptcha?.enterprise));
  if (ready && !forceReload) {
    return;
  }

  await p.goto(HEVY_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: RECAPTCHA_TIMEOUT_MS });
  await p.waitForFunction(() => Boolean((window as any).grecaptcha?.enterprise), {
    timeout: RECAPTCHA_TIMEOUT_MS,
  });
  console.log(`${prefix} 📄 Page loaded`);
};

const ensureBrowser = async (traceId?: string): Promise<void> => {
  if (browserInitInFlight) {
    await browserInitInFlight;
    return;
  }

  const prefix = getTracePrefix(traceId);
  browserInitInFlight = (async () => {
    if (needsBrowserRecycle()) {
      console.log(`${prefix} ♻️  Browser recycling`);
      await closeBrowser('recycle', traceId);
    }

    if (!browser || !browser.isConnected()) {
      console.log(`${prefix} 🚀 Browser launching`);
      browser = await launchBrowser();
      browserCreatedAt = now();
      browserUseCount = 0;
      console.log(`${prefix} ✅ Browser launched`);
    }
  })();

  try {
    await browserInitInFlight;
  } finally {
    browserInitInFlight = null;
  }
};

const createPage = async (traceId?: string): Promise<Page> => {
  if (!browser) throw new Error('Recaptcha browser not available');
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  page.setDefaultNavigationTimeout(RECAPTCHA_TIMEOUT_MS);
  page.setDefaultTimeout(RECAPTCHA_TIMEOUT_MS);
  openPages.add(page);
  page.once('close', () => {
    openPages.delete(page);
    activePages.delete(page);
    if (standbyPage === page) standbyPage = null;
  });
  await ensureRecaptchaLoaded(page, traceId);
  return page;
};

const acquirePage = async (
  traceId?: string
): Promise<{ page: Page; isStandby: boolean; queueMs: number; queuePosition: number }> => {
  const startTime = now();
  let queuePosition = 0;

  while (true) {
    await ensureBrowser(traceId);

    if (standbyPage && !activePages.has(standbyPage) && !isPageClosed(standbyPage)) {
      activePages.add(standbyPage);
      return { page: standbyPage, isStandby: true, queueMs: now() - startTime, queuePosition };
    }

    // Reserve a slot synchronously before awaiting page creation.
    if ((openPages.size + pageCreationReservations) < MAX_PAGES) {
      pageCreationReservations += 1;
      let created = false;
      try {
        const page = await createPage(traceId);
        created = true;
        activePages.add(page);
        return { page, isStandby: false, queueMs: now() - startTime, queuePosition };
      } finally {
        pageCreationReservations = Math.max(0, pageCreationReservations - 1);
        if (!created) {
          const waiter = pageWaiters.shift();
          if (waiter) waiter();
        }
      }
    }

    queuePosition = pageWaiters.length + 1;
    await new Promise<void>((resolve) => {
      pageWaiters.push(resolve);
    });
  }
};

const releasePage = async (page: Page, traceId?: string): Promise<void> => {
  activePages.delete(page);

  if (!standbyPage || standbyPage === page) {
    if (!standbyPage) standbyPage = page;
  } else {
    await closePage(page, 'page_release', traceId);
  }

  if (activePages.size === 0) {
    scheduleIdleClose(traceId);
  }

  const waiter = pageWaiters.shift();
  if (waiter) waiter();
};

const executeRecaptcha = async (p: Page): Promise<string> => {
  const token = await p.evaluate(async (siteKey: string) => {
    const enterprise = (window as any).grecaptcha?.enterprise;
    if (!enterprise) return '';
    return await enterprise.execute(siteKey, { action: 'login' });
  }, RECAPTCHA_SITE_KEY);

  if (!token || typeof token !== 'string') {
    throw new Error('Failed to retrieve recaptcha token');
  }

  return token;
};

const fetchRecaptchaToken = async (context?: RecaptchaContext): Promise<string> => {
  const traceId = context?.traceId;
  const userPrefix = traceId ? `[User][${traceId}]` : '[User]';
  
  const { page, isStandby, queueMs, queuePosition } = await acquirePage(traceId);

  if (queuePosition > 0) {
    console.log(`${userPrefix} ⏳ Waiting for CAPTCHA (#${queuePosition})`);
  }

  try {
    let token: string;
    try {
      console.log(`${userPrefix} 🎯 Executing CAPTCHA`);
      token = await executeRecaptcha(page);
      console.log(`${userPrefix} ✅ CAPTCHA done`);
    } catch {
      console.log(`${userPrefix} ⚠️ CAPTCHA failed, retrying...`);
      await ensureRecaptchaLoaded(page, traceId, true);
      console.log(`${userPrefix} 🎯 Executing CAPTCHA (retry)`);
      token = await executeRecaptcha(page);
      console.log(`${userPrefix} ✅ CAPTCHA done (retry)`);
    }

    browserUseCount += 1;
    console.log(`${userPrefix} 🔑 Token obtained${isStandby ? ' (standby)' : ''}`);
    return token;
  } finally {
    await releasePage(page, traceId);
  }
};

export const getRecaptchaToken = async (context?: RecaptchaContext): Promise<{ token: string; usedCache: boolean }> => {
  if (isTokenCacheValid() && tokenCache) {
    const prefix = context?.traceId ? `[User][${context.traceId}]` : '[User]';
    console.log(`${prefix} 🎯 Using cached reCAPTCHA token`);
    return { token: tokenCache.token, usedCache: true };
  }
  const token = await fetchRecaptchaToken(context);
  return { token, usedCache: false };
};

export const warmRecaptchaSession = async (context?: RecaptchaContext): Promise<void> => {
  if (sessionWarmupInFlight) {
    await sessionWarmupInFlight;
    return;
  }

  if (isTokenCacheValid()) {
    console.log('[System] ✅ Warmup skipped - token already cached');
    return;
  }

  sessionWarmupInFlight = (async () => {
    if (activePages.size > 0 || pageWaiters.length > 0) {
      scheduleIdleClose(context?.traceId);
      return;
    }

    if (standbyPage && !isPageClosed(standbyPage)) {
      scheduleIdleClose(context?.traceId);
      return;
    }

    console.log('[System] 🚀 Warmup starting');

    let page: Page | null = null;
    try {
      const acquired = await acquirePage(context?.traceId);
      page = acquired.page;
      
      console.log('[System] 🎯 Executing CAPTCHA for warmup...');
      const token = await executeRecaptcha(page);
      setTokenCache(token);
      console.log('[System] ✅ Token cached during warmup');
      console.log('[System] ✅ Warmup complete');
    } catch (err) {
      console.warn('[System] ⚠️ Warmup failed:', safeErrorMessage(err));
    } finally {
      if (page) {
        await releasePage(page, context?.traceId);
      }
      scheduleIdleClose(context?.traceId);
    }
  })();

  try {
    await sessionWarmupInFlight;
  } finally {
    sessionWarmupInFlight = null;
  }
};

export const shutdownRecaptchaSession = async (): Promise<void> => {
  await closeBrowser('shutdown');
};

export const clearTokenCache = (): void => {
  clearTokenCacheInternal();
};
