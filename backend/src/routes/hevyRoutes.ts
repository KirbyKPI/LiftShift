import express from 'express';
import { hevyGetAccount, hevyGetWorkoutsPaged, hevyLogin, hevyRefreshToken, hevyValidateAuthToken } from '../hevyApi';
import { mapHevyWorkoutsToWorkoutSets } from '../mapToWorkoutSets';

const createTraceId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const maskIdentifier = (input: string): string => {
  if (!input) return '';
  if (input.length <= 2) return '*'.repeat(input.length);
  if (input.length <= 6) return `${input[0]}***${input[input.length - 1]}`;
  return `${input.slice(0, 2)}***${input.slice(-2)}`;
};

const getClientId = (req: express.Request): string => {
  const raw = req.header('x-liftshift-client-id');
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return 'unknown';
  return id.length <= 64 ? id : id.slice(0, 64);
};

export const createHevyRouter = (opts: {
  loginLimiter: express.RequestHandler;
  requireAuthTokenHeader: (req: express.Request) => string;
  getCachedResponse: <T>(key: string, compute: () => Promise<T>) => Promise<T>;
}) => {
  const { loginLimiter, requireAuthTokenHeader, getCachedResponse } = opts;
  const router = express.Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const traceId = createTraceId('hevy-login');
    const startedAt = Date.now();
    const emailOrUsername = String(req.body?.emailOrUsername ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!emailOrUsername || !password) {
      console.warn('[Hevy Route] Login rejected: missing credentials', { traceId });
      return res.status(400).json({ error: 'Missing emailOrUsername or password' });
    }

    console.log('[Hevy Route] Login started', {
      traceId,
      emailOrUsername: maskIdentifier(emailOrUsername),
      ip: req.ip,
      clientId: getClientId(req),
    });

    try {
      const data = await hevyLogin(emailOrUsername, password, { traceId });
      // Return OAuth2 format with access_token and expires_at
      console.log('[Hevy Route] Login succeeded', {
        traceId,
        durationMs: Date.now() - startedAt,
      });
      res.json({ 
        auth_token: data.auth_token,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user_id, 
        expires_at: data.expires_at 
      });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Login failed';
      console.error('[Hevy Route] Login failed', {
        traceId,
        status,
        durationMs: Date.now() - startedAt,
        message,
      });
      if (status === 401) {
        return res.status(401).json({
          error: `${message}.`,
        });
      }
      res.status(status).json({ error: message });
    }
  });

  router.post('/validate', async (req, res) => {
    const authToken = String(req.body?.auth_token ?? '').trim();
    if (!authToken) return res.status(400).json({ error: 'Missing auth_token' });

    try {
      const valid = await hevyValidateAuthToken(authToken);
      res.json({ valid });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      res.status(status).json({ error: (err as Error).message || 'Validate failed' });
    }
  });

  router.post('/refresh', async (req, res) => {
    const traceId = createTraceId('hevy-refresh');
    const startedAt = Date.now();
    const refreshToken = String(req.body?.refresh_token ?? '').trim();
    const bodyAuthToken = String(req.body?.auth_token ?? '').trim();
    const authHeader = req.header('authorization');
    const matchedAuth = authHeader?.match(/^Bearer\s+(.+)$/i);
    const authToken = bodyAuthToken || (matchedAuth?.[1]?.trim() ?? '');

    if (!refreshToken) {
      console.warn('[Hevy Route] Refresh rejected: missing refresh token', { traceId });
      return res.status(400).json({ error: 'Missing refresh_token' });
    }

    console.log('[Hevy Route] Refresh started', {
      traceId,
      hasAuthToken: Boolean(authToken),
      refreshTokenLength: refreshToken.length,
      ip: req.ip,
      clientId: getClientId(req),
    });

    try {
      const data = await hevyRefreshToken(refreshToken, authToken || undefined, { traceId });
      console.log('[Hevy Route] Refresh succeeded', {
        traceId,
        durationMs: Date.now() - startedAt,
        hasExpiresAt: Boolean(data.expires_at),
        hasRefreshToken: Boolean(data.refresh_token),
      });
      res.json({
        auth_token: data.auth_token,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user_id,
        expires_at: data.expires_at,
      });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Refresh failed';
      console.error('[Hevy Route] Refresh failed', {
        traceId,
        status,
        durationMs: Date.now() - startedAt,
        message,
      });
      if (status === 401) {
        return res.status(401).json({ error: message });
      }
      res.status(status).json({ error: message });
    }
  });

  router.get('/account', async (req, res) => {
    try {
      const token = requireAuthTokenHeader(req);
      const data = await hevyGetAccount(token);
      res.json(data);
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      res.status(status).json({ error: (err as Error).message || 'Failed to fetch account' });
    }
  });

  router.get('/workouts', async (req, res) => {
    const username = String(req.query.username ?? '').trim();
    const offset = Number(req.query.offset ?? 0);

    if (!username) return res.status(400).json({ error: 'Missing username' });
    if (!Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: 'Invalid offset' });

    try {
      const token = requireAuthTokenHeader(req);
      const data = await hevyGetWorkoutsPaged(token, { username, offset });
      res.json(data);
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      res.status(status).json({ error: (err as Error).message || 'Failed to fetch workouts' });
    }
  });

  router.get('/sets', async (req, res) => {
    const username = String(req.query.username ?? '').trim();
    const maxPages = req.query.maxPages != null ? Number(req.query.maxPages) : undefined;

    if (!username) return res.status(400).json({ error: 'Missing username' });
    if (maxPages != null && (!Number.isFinite(maxPages) || maxPages <= 0)) {
      return res.status(400).json({ error: 'Invalid maxPages' });
    }

    try {
      const token = requireAuthTokenHeader(req);
      const cacheKey = `hevySets:${token}:${username}:${maxPages ?? 'all'}`;
      const { workouts, sets } = await getCachedResponse(cacheKey, async () => {
        const allWorkouts = [] as any[];
        let offset = 0;
        let page = 0;

        while (true) {
          if (maxPages != null && page >= maxPages) break;

          const data = await hevyGetWorkoutsPaged(token, { username, offset });
          const workouts = data.workouts ?? [];
          if (workouts.length === 0) break;

          allWorkouts.push(...workouts);
          offset += 5;
          page += 1;
        }

        const sets = mapHevyWorkoutsToWorkoutSets(allWorkouts);
        return { workouts: allWorkouts, sets };
      });
      res.json({ sets, meta: { workouts: workouts.length } });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      res.status(status).json({ error: (err as Error).message || 'Failed to fetch sets' });
    }
  });

  return router;
};
