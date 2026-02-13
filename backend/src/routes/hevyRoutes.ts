import express from 'express';
import { hevyGetAccount, hevyGetWorkoutsPaged, hevyLogin, hevyRefreshToken, hevyValidateAuthToken } from '../hevyApi';
import { warmRecaptchaSession } from '../hevyRecaptcha';
import { mapHevyWorkoutsToWorkoutSets } from '../mapToWorkoutSets';

const createTraceId = (): string => {
  const random = Math.random().toString(36).slice(2, 6);
  const time = Date.now().toString(36).slice(-4);
  return `${time}${random}`;
};

const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const createHevyRouter = (opts: {
  loginLimiter: express.RequestHandler;
  requireAuthTokenHeader: (req: express.Request) => string;
  getCachedResponse: <T>(key: string, compute: () => Promise<T>) => Promise<T>;
}) => {
  const { loginLimiter, requireAuthTokenHeader, getCachedResponse } = opts;
  const router = express.Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const traceId = createTraceId();
    const startedAt = Date.now();
    const emailOrUsername = String(req.body?.emailOrUsername ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Missing emailOrUsername or password' });
    }

    try {
      const data = await hevyLogin(emailOrUsername, password, { traceId });
      const durationMs = Date.now() - startedAt;
      res.json({
        auth_token: data.auth_token,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user_id,
        expires_at: data.expires_at,
      });
      console.log(`[User][${traceId}] ✅ Login successful (${formatDuration(durationMs)})`);

      // Log user profile asynchronously to avoid delaying response
      void (async () => {
        try {
          const account = await hevyGetAccount(data.auth_token);
          const profileUrl = `https://hevy.com/user/${account.username}`;
          const displayEmail = emailOrUsername?.includes('@') ? emailOrUsername : (account.email || '');
          console.log(`[User][${traceId}] 👤 ${account.full_name || account.username} (@${account.username}) ${displayEmail} ${profileUrl}`);
        } catch {
          // Silent fail - not critical for login
        }
      })();
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Login failed';
      const durationMs = Date.now() - startedAt;
      console.error(`[User][${traceId}] ❌ Login failed for ${emailOrUsername}: ${message} (${formatDuration(durationMs)})`);
      if (status === 401) {
        return res.status(401).json({
          error: `${message}.`,
        });
      }
      res.status(status).json({ error: message });
      console.log(`[User][${traceId}] 🧭 Login flow total (${formatDuration(Date.now() - startedAt)})`);
      return;
    }
    console.log(`[User][${traceId}] 🧭 Login flow total (${formatDuration(Date.now() - startedAt)})`);
  });

  // Warm only the browser/page session, not token. This avoids stale-token 400s.
  router.post('/recaptcha/session-warmup', async (req, res) => {
    const traceId = createTraceId();
    const emailOrUsername = String(req.body?.emailOrUsername ?? '').trim();
    if (!emailOrUsername) return res.status(400).json({ error: 'Missing emailOrUsername' });

    try {
      await warmRecaptchaSession({ traceId });
      res.json({ warmed: true });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Session warmup failed';
      res.status(status).json({ error: message });
    }
  });

  // Backward-compatible endpoint. Kept for clients that still call the old warmup route.
  router.post('/recaptcha/warmup', async (req, res) => {
    const traceId = createTraceId();
    const emailOrUsername = String(req.body?.emailOrUsername ?? '').trim();
    if (!emailOrUsername) return res.status(400).json({ error: 'Missing emailOrUsername' });

    try {
      await warmRecaptchaSession({ traceId });
      res.json({ warmed: true });
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Warmup failed';
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
    const traceId = createTraceId();
    const startedAt = Date.now();
    const refreshToken = String(req.body?.refresh_token ?? '').trim();
    const emailOrUsername = String(req.body?.emailOrUsername ?? '').trim();
    const bodyAuthToken = String(req.body?.auth_token ?? '').trim();
    const authHeader = req.header('authorization');
    const matchedAuth = authHeader?.match(/^Bearer\s+(.+)$/i);
    const authToken = bodyAuthToken || (matchedAuth?.[1]?.trim() ?? '');

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh_token' });
    }

    try {
      const data = await hevyRefreshToken(refreshToken, authToken || undefined, { traceId });
      const durationMs = Date.now() - startedAt;
      res.json({
        auth_token: data.auth_token,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user_id,
        expires_at: data.expires_at,
      });
      console.log(`[User][${traceId}] 🔄 Refresh successful (${formatDuration(durationMs)})`);

      // Log user profile asynchronously to avoid delaying response
      void (async () => {
        try {
          const account = await hevyGetAccount(data.auth_token);
          const profileUrl = `https://hevy.com/user/${account.username}`;
          const displayEmail = emailOrUsername?.includes('@') ? emailOrUsername : (account.email || '');
          console.log(`[User][${traceId}] 👤 ${account.full_name || account.username} (@${account.username}) ${displayEmail} ${profileUrl}`);
        } catch {
          // Silent fail - not critical for refresh
        }
      })();
    } catch (err) {
      const status = (err as any).statusCode ?? 500;
      const message = (err as Error).message || 'Refresh failed';
      const durationMs = Date.now() - startedAt;
      console.error(`[User][${traceId}] ❌ Refresh failed for ${emailOrUsername || 'unknown'}: ${message} (${formatDuration(durationMs)})`);
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
