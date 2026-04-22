import type express from 'express';
import { captureBackendEvent } from './posthog';
import { getClientIP } from '../geoLocation';

const CLIENT_ID_HEADER = 'x-kpifit-client-id';

export const getAnalyticsDistinctId = (req: express.Request): string => {
  const raw = req.header(CLIENT_ID_HEADER);
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (id && id.length <= 128) return id;

  // Fallback: still provides some value for request-level analysis.
  const ip = String(req.ip ?? '').trim();
  if (ip) return `ip:${ip}`;

  return 'unknown';
};

export const getAnalyticsIP = (req: express.Request): string => {
  return getClientIP(req);
};

const getOriginHostname = (origin: string | undefined): string | undefined => {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
};

export const analyticsRequestMiddleware: express.RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  const distinctId = getAnalyticsDistinctId(req);
  const clientIP = getAnalyticsIP(req);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;

    // Avoid capturing query strings to reduce the chance of sending user identifiers.
    const path = req.path;

    const eventProperties: Record<string, unknown> = {
      method: req.method,
      path,
      status: res.statusCode,
      duration_ms: durationMs,
      origin_host: getOriginHostname(req.header('origin')),
      ua: req.header('user-agent')?.slice(0, 200),
      has_auth_token: Boolean(req.header('authorization')),
    };

    // Pass IP to PostHog for automatic GeoIP resolution
    if (clientIP && !clientIP.startsWith('192.168.') && !clientIP.startsWith('10.') && !clientIP.startsWith('172.') && clientIP !== '127.0.0.1') {
      eventProperties.$ip = clientIP;
    }

    captureBackendEvent(distinctId, 'api_request', eventProperties);

    if (res.statusCode >= 400) {
      captureBackendEvent(distinctId, 'api_response_error', {
        method: req.method,
        path,
        status: res.statusCode,
        origin_host: getOriginHostname(req.header('origin')),
      });
    }
  });

  next();
};
