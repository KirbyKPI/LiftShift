import puppeteer, { type Browser } from 'puppeteer';

const HEVY_LOGIN_URL = 'https://hevy.com/login';
const RECAPTCHA_SITE_KEY = '6LfkQG0jAAAAANTrIkVXKPfSPHyJnt4hYPWqxh0R';
const RECAPTCHA_TTL_MS = 90_000;

let browserPromise: Promise<Browser> | null = null;
let tokenCache: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

const launchBrowser = async (): Promise<Browser> => {
  if (!browserPromise) {
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
      ],
    };
    browserPromise = puppeteer.launch({
      ...launchOptions,
    });
  }
  return browserPromise;
};

export const getRecaptchaToken = async (): Promise<string> => {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.value;
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();

    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
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

      tokenCache = { value: token, expiresAt: Date.now() + RECAPTCHA_TTL_MS };
      return token;
    } finally {
      await page.close();
      tokenInFlight = null;
    }
  })();

  return tokenInFlight;
};
