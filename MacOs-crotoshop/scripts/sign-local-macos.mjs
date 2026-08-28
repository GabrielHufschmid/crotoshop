import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const target = path.resolve(process.argv[2] || 'release/mac-arm64/Crotoshop.app');
if (!existsSync(target)) {
  console.error(`No existe el artefacto local: ${target}`);
  process.exit(1);
}

const isApp = target.endsWith('.app');
const args = isApp
  ? ['--force', '--deep', '--options', 'runtime', '--timestamp=none', '--entitlements', path.resolve('build/entitlements.mac.plist'), '--sign', '-', target]
  : ['--force', '--timestamp=none', '--sign', '-', target];
execFileSync('codesign', args, { stdio: 'inherit' });
if (isApp) execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', target], { stdio: 'inherit' });
