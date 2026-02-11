import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { analyticsRequestMiddleware } from './analytics/requestTracking';
import { shutdownPosthog } from './analytics/posthog';
import { createHevyRouter } from './routes/hevyRoutes';
import { createHevyProRouter } from './routes/hevyProRoutes';
import { createLyftaRouter } from './routes/lyftaRoutes';

const PORT = Number(process.env.PORT ?? 5000);

const app = express();

type CachedValue<T> = {
  value?: T;
  timestamp: number;
  inFlight?: Promise<T>;
};

const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000;
const RESPONSE_CACHE_MAX = 50;
const responseCache = new Map<string, CachedValue<unknown>>();

const getCachedResponse = async <T>(key: string, compute: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const existing = responseCache.get(key);
  if (existing && existing.value !== undefined && (now - existing.timestamp) < RESPONSE_CACHE_TTL_MS) {
    return existing.value as T;
  }
  if (existing?.inFlight) return existing.inFlight as Promise<T>;

  const inFlight = compute()
    .then((value) => {
      responseCache.set(key, { value, timestamp: Date.now() });
      if (responseCache.size > RESPONSE_CACHE_MAX) {
        const entries = Array.from(responseCache.entries())
          .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
        const toRemove = entries.slice(0, responseCache.size - RESPONSE_CACHE_MAX);
        for (const [oldKey] of toRemove) responseCache.delete(oldKey);
      }
      return value;
    })
    .catch((err) => {
      responseCache.delete(key);
      throw err;
    });

  responseCache.set(key, { timestamp: now, inFlight });
  return inFlight;
};

// Render/Cloudflare set X-Forwarded-For. Enabling trust proxy allows express-rate-limit
// to correctly identify clients and avoids ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
// We keep this enabled even if NODE_ENV isn't set, since hosted platforms commonly omit it.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(analyticsRequestMiddleware);

const isPrivateLanOrigin = (origin: string): boolean => {
  try {
    const u = new URL(origin);
    const host = u.hostname;

    if (host === 'localhost' || host === '127.0.0.1') return true;
    // RFC1918 private ranges.
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;

    return false;
  } catch {
    return false;
  }
};

const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Allow private LAN origins in both dev and prod for local development against hosted backend
      if (isPrivateLanOrigin(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-liftshift-client-id'],
    maxAge: 86400,
  })
);

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const requireAuthTokenHeader = (req: express.Request): string => {
  const authHeader = req.header('authorization');
  if (!authHeader) {
    const err = new Error('Missing authorization header');
    (err as any).statusCode = 401;
    throw err;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const err = new Error('Invalid authorization header');
    (err as any).statusCode = 401;
    throw err;
  }
  return match[1];
};

app.get('/api/health', (_req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'ok',
    memory: {
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
    },
    uptime: process.uptime(),
  });
});

app.use('/api/hevy', createHevyRouter({ loginLimiter, requireAuthTokenHeader, getCachedResponse }));
app.use('/api/hevy', createHevyProRouter({ loginLimiter, getCachedResponse }));
app.use('/api/lyfta', createLyftaRouter({ loginLimiter, getCachedResponse }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  if (message === 'CORS blocked') return res.status(403).json({ error: message });

  const status = (err as any)?.statusCode ?? 500;
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => {
  console.log(`LiftShift backend listening on :${PORT}`);
});

let shuttingDown = false;

const shutdown = async (signal: string, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Server] Received ${signal}, shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Server] Force exiting after shutdown timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    console.log('[Server] HTTP server closed');
  } catch (err) {
    console.error('[Server] Error closing HTTP server:', err);
  }

  try {
    await shutdownPosthog();
    console.log('[Server] PostHog shutdown complete');
  } catch (err) {
    console.error('[Server] Error during PostHog shutdown:', err);
  }

  console.log('[Server] Graceful shutdown complete');
  clearTimeout(forceExitTimer);
  process.exit(exitCode);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
  shutdown('uncaughtException', 1).catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});
