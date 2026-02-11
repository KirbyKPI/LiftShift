import puppeteer, { type Browser } from 'puppeteer';

const HEVY_LOGIN_URL = 'https://hevy.com/login';
const RECAPTCHA_SITE_KEY = '6LfkQG0jAAAAANTrIkVXKPfSPHyJnt4hYPWqxh0R';
const RECAPTCHA_TTL_MS = 90_000;

// Token cache to avoid redundant browser launches within 90 seconds
let tokenCache: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

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
  console.log('[Puppeteer] Launching browser for recaptcha');
  return puppeteer.launch(launchOptions);
};

export const getRecaptchaToken = async (): Promise<string> => {
  const now = Date.now();
  
  // Return cached token if still valid
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.value;
  }
  
  // Return in-flight promise if already getting token
  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = (async () => {
    let browser: Browser | null = null;
    
    try {
      // Launch fresh browser for this request
      browser = await launchBrowser();
      const page = await browser.newPage();

      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        
        // Set navigation timeout to prevent hanging
        page.setDefaultNavigationTimeout(30000);
        page.setDefaultTimeout(30000);
        
        await page.goto(HEVY_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        await page.waitForFunction(() => (window as any).grecaptcha && (window as any).grecaptcha.enterprise, {
          timeout: 15000,
        });

        const token = await page.evaluate(async (siteKey: string) => {
          const grecaptcha = (window as any).grecaptcha;
          return await grecaptcha.enterprise.execute(siteKey, { action: 'login' });
        }, RECAPTCHA_SITE_KEY);

        if (!token || typeof token !== 'string') {
          throw new Error('Failed to retrieve recaptcha token');
        }

        // Cache the token for 90 seconds
        tokenCache = { value: token, expiresAt: Date.now() + RECAPTCHA_TTL_MS };
        return token;
      } finally {
        // Always close the page
        await page.close();
      }
    } finally {
      // Always close the browser to prevent memory leaks
      if (browser) {
        try {
          await browser.close();
          console.log('[Puppeteer] Browser closed');
        } catch (closeError) {
          console.error('[Puppeteer] Failed to close browser:', closeError);
        }
      }
      tokenInFlight = null;
    }
  })();

  return tokenInFlight;
};

// Clear token cache (useful for testing or manual reset)
export const clearTokenCache = (): void => {
  tokenCache = null;
  tokenInFlight = null;
};
