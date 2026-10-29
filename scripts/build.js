// Build dist/fleetbar.js (IIFE for a plain <script>) and dist/fleetbar.mjs (one-file
// ESM) from src/logic.js + src/element.js. No bundler: both sources are written so
// that stripping their import/export keywords leaves valid script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function strip(file) {
  const src = readFileSync(join(root, 'src', file), 'utf8');
  // Drop whole import statements (they may span lines), then the export keyword.
  const out = src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/gm, '');
  if (/^\s*(import|export)\b/m.test(out)) {
    throw new Error(`${file}: an import/export survived stripping`);
  }
  return `// --- ${file} ---\n${out}`;
}

const banner = `/*! @profullstack/fleetbar v${pkg.version} | MIT | https://github.com/profullstack/fleetbar */`;
// Escape non-ASCII so a classic <script> served without a charset still reads right.
const body = [strip('logic.js'), strip('element.js')].join('\n')
  .replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const names = [
  'FleetBar', 'defineFleetBar', 'STYLES', 'CHECK_TYPES', 'SSH_NOTE', 'MIN_INTERVAL_S', 'KEYRING_URL',
  'buildMonitorBody', 'checkPublicKey', 'normalizeKeysUrl', 'esc', 'errorMessage', 'stateOf',
  'targetLabel', 'timeAgo', 'formatLatency', 'shortFingerprint', 'isValidUsername', 'safeHref',
];

const iife = `${banner}
(function () {
'use strict';
${body}
defineFleetBar();
if (typeof window !== 'undefined') {
  window.FleetBar = { ${names.join(', ')}, version: ${JSON.stringify(pkg.version)} };
}
})();
`;

const esm = `${banner}
${body}
defineFleetBar();
export { ${names.join(', ')} };
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'fleetbar.js'), iife);
writeFileSync(join(root, 'dist', 'fleetbar.mjs'), esm);
console.log(`built dist/fleetbar.js (${iife.length} bytes) and dist/fleetbar.mjs (${esm.length} bytes)`);
