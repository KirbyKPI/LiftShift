import type {
  HevyAccountResponse,
  HevyLoginResponse,
  HevyPagedWorkoutsResponse,
} from './types';
import { getRecaptchaToken } from './hevyRecaptcha';

const requireEnv = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
};

const HEVY_BASE_URL = process.env.HEVY_BASE_URL ?? 'https://api.hevyapp.com';

const readPositiveNumberEnv = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HEVY_LOGIN_TIMEOUT_MS = readPositiveNumberEnv('HEVY_LOGIN_TIMEOUT_MS', 20_000);
const HEVY_REFRESH_TIMEOUT_MS = readPositiveNumberEnv('HEVY_REFRESH_TIMEOUT_MS', 15_000);
const HEVY_REFRESH_PATH = process.env.HEVY_REFRESH_PATH ?? '/auth/refresh_token';

type HevyRequestContext = {
  traceId?: string;
};

// Build headers for OAuth2 Bearer token authentication
const buildHeaders = (accessToken?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': requireEnv('HEVY_X_API_KEY'),
    'Origin': 'https://www.hevy.com',
    'Referer': 'https://www.hevy.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Hevy-Platform': 'web',
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
};

const mapOAuthResponse = (data: HevyLoginResponse): HevyLoginResponse => {
  if (data.access_token && !data.auth_token) {
    data.auth_token = data.access_token;
  }
  return data;
};

const parseErrorBody = async (res: Response): Promise<string> => {
  try {
    const text = await res.text();
    return text || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
};

const timeoutSignal = (timeoutMs: number): AbortSignal | undefined => {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(timeoutMs);
};

const maskIdentifier = (input: string): string => {
  if (!input) return '';
  if (input.length <= 2) return '*'.repeat(input.length);
  if (input.length <= 6) return `${input[0]}***${input[input.length - 1]}`;
  return `${input.slice(0, 2)}***${input.slice(-2)}`;
};

const getTraceLabel = (traceId?: string): string => (traceId ? `[${traceId}]` : '[no-trace]');
const buildEndpointUrl = (path: string): string => (
  path.startsWith('/') ? `${HEVY_BASE_URL}${path}` : `${HEVY_BASE_URL}/${path}`
);

export const hevyLogin = async (
  emailOrUsername: string,
  password: string,
  context: HevyRequestContext = {}
): Promise<HevyLoginResponse> => {
  const trace = getTraceLabel(context.traceId);
  const startedAt = Date.now();
  const recaptchaStartedAt = Date.now();
  const recaptchaToken = await getRecaptchaToken({ traceId: context.traceId });
  const recaptchaDurationMs = Date.now() - recaptchaStartedAt;

  const headers = buildHeaders();

  const body = { emailOrUsername, password, recaptchaToken, useAuth2_0: true };

  console.log(`[Hevy Login] Request ${trace}:`, {
    url: buildEndpointUrl('/login'),
    headers: { ...headers, 'x-api-key': '***' },
    body: {
      emailOrUsername: maskIdentifier(emailOrUsername),
      password: '***',
      recaptchaTokenLength: recaptchaToken.length,
      useAuth2_0: true,
    },
    recaptchaDurationMs,
  });

  const requestStartedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(buildEndpointUrl('/login'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutSignal(HEVY_LOGIN_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[Hevy Login] Network error ${trace}:`, {
      error: err instanceof Error ? err.message : String(err),
      requestDurationMs: Date.now() - requestStartedAt,
      totalDurationMs: Date.now() - startedAt,
    });
    throw err;
  }

  const requestDurationMs = Date.now() - requestStartedAt;
  console.log(`[Hevy Login] Response ${trace}:`, {
    status: res.status,
    statusText: res.statusText,
    requestDurationMs,
  });

  if (!res.ok) {
    const msg = await parseErrorBody(res);
    console.error(`[Hevy Login] Error ${trace}:`, {
      message: msg,
      totalDurationMs: Date.now() - startedAt,
    });
    const err = new Error(msg);
    (err as any).statusCode = res.status;
    throw err;
  }

  const payload = mapOAuthResponse(await res.json() as HevyLoginResponse);
  console.log(`[Hevy Login] Success ${trace}:`, {
    totalDurationMs: Date.now() - startedAt,
    hasExpiresAt: Boolean(payload.expires_at),
    hasRefreshToken: Boolean(payload.refresh_token),
    userId: payload.user_id,
  });
  return payload;
};

export const hevyRefreshToken = async (
  refreshToken: string,
  accessToken?: string,
  context: HevyRequestContext = {}
): Promise<HevyLoginResponse> => {
  const trace = getTraceLabel(context.traceId);
  const startedAt = Date.now();
  const trimmedRefreshToken = String(refreshToken ?? '').trim();
  if (!trimmedRefreshToken) {
    const err = new Error('Missing refresh_token');
    (err as any).statusCode = 400;
    throw err;
  }

  const headers = buildHeaders(accessToken);
  const body = { refresh_token: trimmedRefreshToken };
  const refreshUrl = buildEndpointUrl(HEVY_REFRESH_PATH);

  console.log(`[Hevy Refresh] Request ${trace}:`, {
    url: refreshUrl,
    headers: { ...headers, 'x-api-key': '***' },
    body: { refreshTokenLength: trimmedRefreshToken.length },
    hasAuthorization: Boolean(accessToken),
  });

  const requestStartedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(refreshUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutSignal(HEVY_REFRESH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[Hevy Refresh] Network error ${trace}:`, {
      error: err instanceof Error ? err.message : String(err),
      requestDurationMs: Date.now() - requestStartedAt,
      totalDurationMs: Date.now() - startedAt,
    });
    throw err;
  }

  const requestDurationMs = Date.now() - requestStartedAt;
  console.log(`[Hevy Refresh] Response ${trace}:`, {
    status: res.status,
    statusText: res.statusText,
    requestDurationMs,
  });

  if (!res.ok) {
    const msg = await parseErrorBody(res);
    console.error(`[Hevy Refresh] Error ${trace}:`, {
      message: msg,
      totalDurationMs: Date.now() - startedAt,
    });
    const err = new Error(msg);
    (err as any).statusCode = res.status;
    throw err;
  }

  const payload = mapOAuthResponse(await res.json() as HevyLoginResponse);
  console.log(`[Hevy Refresh] Success ${trace}:`, {
    totalDurationMs: Date.now() - startedAt,
    hasExpiresAt: Boolean(payload.expires_at),
    hasRefreshToken: Boolean(payload.refresh_token),
  });
  return payload;
};

// Validate token by checking expiry or making a test request
export const hevyValidateAuthToken = async (accessToken: string): Promise<boolean> => {
  try {
    // Try to get account info - if it works, token is valid
    await hevyGetAccount(accessToken);
    return true;
  } catch (err) {
    const status = (err as any)?.statusCode;
    if (status === 401) return false;
    throw err;
  }
};

export const hevyGetAccount = async (accessToken: string): Promise<HevyAccountResponse> => {
  const res = await fetch(`${HEVY_BASE_URL}/user/account`, {
    method: 'GET',
    headers: buildHeaders(accessToken),
  });

  if (!res.ok) {
    const msg = await parseErrorBody(res);
    const err = new Error(msg);
    (err as any).statusCode = res.status;
    throw err;
  }

  return (await res.json()) as HevyAccountResponse;
};

export const hevyGetWorkoutsPaged = async (
  accessToken: string,
  opts: { username: string; offset: number }
): Promise<HevyPagedWorkoutsResponse> => {
  const params = new URLSearchParams({
    username: opts.username,
    offset: String(opts.offset),
  });

  const res = await fetch(`${HEVY_BASE_URL}/user_workouts_paged?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders(accessToken),
  });

  if (!res.ok) {
    const msg = await parseErrorBody(res);
    const err = new Error(msg);
    (err as any).statusCode = res.status;
    throw err;
  }

  return (await res.json()) as HevyPagedWorkoutsResponse;
};
