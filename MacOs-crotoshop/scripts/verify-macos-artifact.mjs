import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const appPath = path.resolve(process.argv[2] || 'release/mac-arm64/Crotoshop.app');
if (!existsSync(appPath)) {
  console.error(`No existe el paquete: ${appPath}`);
  process.exit(1);
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit' });
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
run('xcrun', ['stapler', 'validate', appPath]);
console.log('Firma, Gatekeeper y ticket de notarización validados.');
