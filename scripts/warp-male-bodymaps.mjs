import { readFile, writeFile } from 'node:fs/promises';
import svgpath from 'svgpath';

const FILES = [
  'frontend/components/bodyMap/groups/maleFront/MaleFrontBodyMapGroupPart1.tsx',
  'frontend/components/bodyMap/groups/maleFront/MaleFrontBodyMapGroupPart2.tsx',
  'frontend/components/bodyMap/groups/maleBack/MaleBackBodyMapGroupPart1.tsx',
  'frontend/components/bodyMap/groups/maleBack/MaleBackBodyMapGroupPart2.tsx',
];

const MID_X = 330.26;

const clamp01 = n => Math.max(0, Math.min(1, n));

// x-distance based mask so arms/hands get minimal distortion.
const torsoMask = x => {
  const dx = Math.abs(x - MID_X);
  // Full effect within ~120px from midline, fading out by ~200px.
  return clamp01(1 - (dx - 120) / 80);
};

const gaussian = (y, mu, sigma) => {
  const z = (y - mu) / sigma;
  return Math.exp(-0.5 * z * z);
};

// Warp aims: slimmer waist + slightly leaner overall, without mangling limbs.
const xScaleAt = y => {
  // Waist is the main taper.
  const waist = 0.1 * gaussian(y, 520, 140);
  // Small taper around lower ribcage.
  const chest = 0.03 * gaussian(y, 320, 180);
  // Mild slimming through thighs.
  const thighs = 0.04 * gaussian(y, 820, 220);

  // Reduce effect near very top/bottom.
  const topFade = clamp01((y - 120) / 120);
  const bottomFade = clamp01((1120 - y) / 160);
  const verticalMask = Math.min(1, topFade, bottomFade);

  const amount = Math.min(0.12, waist + chest + thighs) * verticalMask;
  return 1 - amount;
};

const warpPoint = (x, y) => {
  const mask = torsoMask(x);
  if (mask <= 0) return [x, y];
  const s = 1 - (1 - xScaleAt(y)) * mask;
  return [MID_X + (x - MID_X) * s, y];
};

const warpPathD = d => {
  try {
    return svgpath(d)
      .abs()
      .iterate((seg, _idx, x, y) => {
        const cmd = seg[0];

        // Helper for (x,y) pairs starting at index i.
        const warpXY = i => {
          const nx = Number(seg[i]);
          const ny = Number(seg[i + 1]);
          if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
          const [wx, wy] = warpPoint(nx, ny);
          seg[i] = wx;
          seg[i + 1] = wy;
        };

        if (cmd === 'M' || cmd === 'L' || cmd === 'T') {
          warpXY(1);
        } else if (cmd === 'H') {
          const nx = Number(seg[1]);
          if (Number.isFinite(nx)) {
            const [wx] = warpPoint(nx, y);
            seg[1] = wx;
          }
        } else if (cmd === 'V') {
          // y-only
        } else if (cmd === 'C') {
          warpXY(1);
          warpXY(3);
          warpXY(5);
        } else if (cmd === 'S' || cmd === 'Q') {
          warpXY(1);
          warpXY(3);
        } else if (cmd === 'A') {
          // Only warp the endpoint (x,y). Keep radii/flags stable.
          warpXY(6);
        } else if (cmd === 'Z') {
          // noop
        }
      })
      .round(2)
      .toString();
  } catch {
    return d;
  }
};

const round2 = n => Math.round(n * 100) / 100;

const warpAllPathsInTsx = tsx => {
  // d="..." only (the bodymap files use this format).
  return tsx.replace(/\sd="([^"]+)"/g, (m, d) => {
    const nd = warpPathD(d);
    return ` d="${nd}"`;
  });
};

const warpAllLinesInTsx = tsx => {
  // Warp <line x1/y1/x2/y2 ...> endpoints too (Part2 includes a few).
  return tsx.replace(/<line\b[^>]*>/g, tag => {
    const readAttr = name => {
      const brace = tag.match(new RegExp(`${name}=\\{([+\\-0-9.eE]+)\\}`));
      if (brace) return { value: Number(brace[1]), kind: 'brace' };
      const quote = tag.match(new RegExp(`${name}="([+\\-0-9.eE]+)"`));
      if (quote) return { value: Number(quote[1]), kind: 'quote' };
      return null;
    };

    const x1 = readAttr('x1');
    const y1 = readAttr('y1');
    const x2 = readAttr('x2');
    const y2 = readAttr('y2');
    if (!x1 || !y1 || !x2 || !y2) return tag;
    if (![x1.value, y1.value, x2.value, y2.value].every(Number.isFinite)) return tag;

    const [wx1, wy1] = warpPoint(x1.value, y1.value);
    const [wx2, wy2] = warpPoint(x2.value, y2.value);

    const writeAttr = (src, name, kind, value) => {
      const v = round2(value);
      if (kind === 'brace') return src.replace(new RegExp(`${name}=\\{([+\\-0-9.eE]+)\\}`), `${name}={${v}}`);
      return src.replace(new RegExp(`${name}="([+\\-0-9.eE]+)"`), `${name}="${v}"`);
    };

    let out = tag;
    out = writeAttr(out, 'x1', x1.kind, wx1);
    out = writeAttr(out, 'y1', y1.kind, wy1);
    out = writeAttr(out, 'x2', x2.kind, wx2);
    out = writeAttr(out, 'y2', y2.kind, wy2);
    return out;
  });
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');

  let touched = 0;
  for (const file of FILES) {
    const before = await readFile(file, 'utf8');
    const after = warpAllLinesInTsx(warpAllPathsInTsx(before));
    if (after !== before) {
      touched++;
      if (!dryRun) await writeFile(file, after, 'utf8');
    }
  }

  const mode = dryRun ? 'dry-run' : 'write';
  console.log(`[warp-male-bodymaps] mode=${mode} files_changed=${touched}/${FILES.length}`);
};

await main();
