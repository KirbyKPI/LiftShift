export { Head };

import React from 'react';
import type { PageContext } from 'vike/types';

function Head() {
  const baseUrl = (import.meta as any).env?.BASE_URL;
  const base = typeof baseUrl === 'string' ? baseUrl : '/';
  const withBase = (path: string) => `${base}${path.replace(/^\/+/, '')}`;
  const themeInitScript = `
    (function () {
      try {
        var key = 'hevy_analytics_theme_mode';
        var stored = localStorage.getItem(key);
        var mode =
          stored === 'light' || stored === 'medium-dark' || stored === 'midnight-dark' || stored === 'pure-black'
            ? stored
            : 'pure-black';
        document.documentElement.dataset.theme = mode;
        document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark';
      } catch (e) {
        // ignore
      }
    })();
  `;
  const deepLinkRestoreScript = `
    (function () {
      // GitHub Pages SPA deep-linking support.
      // If we were redirected via /404.html, restore the original URL so the app can load normally.
      try {
        var params = new URLSearchParams(window.location.search || '');
        var p = params.get('p');
        var q = params.get('q');
        var h = params.get('h');
        if (!p) return;

        params.delete('p');
        params.delete('q');
        params.delete('h');

        var rest = params.toString();
        var search = (q ? decodeURIComponent(q) : '') || (rest ? '?' + rest : '');
        var hash = (h ? decodeURIComponent(h) : '');
        var path = decodeURIComponent(p);

        var baseHref = document.querySelector('base')?.getAttribute('href') || '/';
        var basePath = baseHref.endsWith('/') ? baseHref : baseHref + '/';

        if (basePath !== '/' && path.indexOf(basePath) !== 0) {
          path = basePath.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
        }

        window.history.replaceState(null, '', path + search + hash);
      } catch (e) {
        // ignore
      }
    })();
  `;

  return (
    <>
      <link rel="icon" href={withBase('favicon.ico')} />
      <link rel="icon" href={withBase('favicon.png')} type="image/png" sizes="48x48" />
      <link rel="shortcut icon" href={withBase('favicon.ico')} />
      <link rel="apple-touch-icon" href={withBase('UI/logo.png')} sizes="180x180" />

      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <script dangerouslySetInnerHTML={{ __html: deepLinkRestoreScript }} />

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
      <style>{`
        /* Italic text styling with Libre Baskerville */
        em, i, [class*="italic"] {
          font-family: "Libre Baskerville", "Poppins", sans-serif !important;
          font-weight: 600;
          font-style: italic;
        }
      `}</style>
    </>
  );
}
