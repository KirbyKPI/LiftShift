import { createProxyMiddleware } from 'http-proxy-middleware';

const API_HOST = process.env.POSTHOG_HOST?.replace(/^https?:\/\//, '') || 'us.i.posthog.com';
const ASSET_HOST = process.env.POSTHOG_REGION === 'eu' ? 'eu-assets.i.posthog.com' : 'us-assets.i.posthog.com';

const onProxyRes = (proxyRes: any, req: any, res: any) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

export const createPosthogProxy = (prefix: string) => {
  return createProxyMiddleware({
    target: `https://${API_HOST}`,
    changeOrigin: true,
    secure: true,
    pathRewrite: {
      [`^${prefix}`]: '',
    },
    on: {
      proxyReq: (proxyReq: any, req: any) => {
        proxyReq.setHeader('host', API_HOST);
        proxyReq.setHeader('X-Real-IP', req.ip || '');
        proxyReq.setHeader('X-Forwarded-For', req.headers['x-forwarded-for'] || req.ip || '');
      },
      proxyRes: onProxyRes,
    },
  } as any);
};

export const createPosthogStaticProxy = (prefix: string) => {
  return createProxyMiddleware({
    target: `https://${ASSET_HOST}`,
    changeOrigin: true,
    secure: true,
    pathRewrite: {
      [`^${prefix}/static`]: '/static',
    },
    on: {
      proxyReq: (proxyReq: any, req: any) => {
        proxyReq.setHeader('host', ASSET_HOST);
        proxyReq.setHeader('X-Real-IP', req.ip || '');
        proxyReq.setHeader('X-Forwarded-For', req.headers['x-forwarded-for'] || req.ip || '');
      },
      proxyRes: onProxyRes,
    },
  } as any);
};

export const posthogProxyPath = '/ingest';
