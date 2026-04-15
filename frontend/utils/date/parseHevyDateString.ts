import { parse } from 'date-fns';
import { DATE_FORMAT_HEVY, isPlausibleDate } from './dateUtils';

export const parseHevyDateString = (value: string): Date | undefined => {
  if (!value) return undefined;
  try {
    const s = String(value).trim();
    if (!s) return undefined;

    // Prefer the native parser for ISO 8601 strings that already encode an offset.
    // That preserves the original instant instead of reinterpreting the wall time.
    if (/[Tt]/.test(s) && (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s))) {
      const isoDate = new Date(s);
      if (isPlausibleDate(isoDate)) return isoDate;
    }

    const normalizeTwoDigitYearIfNeeded = (d: Date): Date => {
      const y = d.getFullYear();
      // date-fns parses 2-digit years using the reference date's century.
      // With an epoch reference, "23" becomes 1923.
      if (y > 0 && y < 1971) {
        const bumped = y + 100;
        if (bumped >= 1971 && bumped <= 2099) {
          const copy = new Date(d.getTime());
          copy.setFullYear(bumped);
          return copy;
        }
      }
      return d;
    };

    const formats = [
      DATE_FORMAT_HEVY,
      'd MMM yyyy, HH:mm:ss',
      'd MMM yy, HH:mm',
      'd MMM yy, HH:mm:ss',
      "yyyy-MM-dd'T'HH:mm:ssXXX",
      "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
      "yyyy-MM-dd'T'HH:mm:ss",
      'yyyy-MM-dd HH:mm:ss',
      'yyyy-MM-dd HH:mm',
      'yyyy-MM-dd',
    ];

    for (const fmt of formats) {
      try {
        const d = normalizeTwoDigitYearIfNeeded(parse(s, fmt, new Date(0)));
        if (isPlausibleDate(d)) return d;
      } catch {
        // continue
      }
    }

    const native = new Date(s);
    if (isPlausibleDate(native)) return native;

    return undefined;
  } catch {
    return undefined;
  }
};
