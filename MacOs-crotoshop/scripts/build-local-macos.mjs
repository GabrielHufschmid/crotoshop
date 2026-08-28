import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.error('La compilación local de macOS solo se puede ejecutar en una Mac.');
  process.exit(1);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const outputDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const appPath = path.join('release', outputDir, 'Crotoshop.app');
const dmgPath = path.join('release', `Crotoshop-${pkg.version}-${process.arch}.dmg`);
const unsignedEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };

run('npm', ['run', 'build']);
run('npm', ['run', 'build:backend']);
run('npx', ['electron-builder', '--mac', 'dir'], unsignedEnv);
run(process.execPath, ['scripts/sign-local-macos.mjs', appPath]);
run('npx', ['electron-builder', '--mac', 'dmg', '--prepackaged', appPath], unsignedEnv);
run(process.execPath, ['scripts/sign-local-macos.mjs', dmgPath]);
