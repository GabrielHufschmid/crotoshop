import { execFileSync } from 'node:child_process';
import process from 'node:process';

function fail(message) {
  console.error(`\nNo se puede crear una distribución pública:\n${message}\n`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('La versión de macOS debe compilarse y firmarse desde una Mac.');

let identities = '';
try {
  identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
} catch {
  fail('No se pudo consultar el llavero de macOS.');
}
if (!identities.includes('Developer ID Application:')) {
  fail('Falta un certificado “Developer ID Application” válido en el llavero.');
}

const hasApiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
const hasAppleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
const hasKeychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
  fail('Faltan credenciales de notarización (API key, Apple ID o perfil de notarytool).');
}

try {
  execFileSync('xcrun', ['notarytool', '--version'], { stdio: 'ignore' });
} catch {
  fail('notarytool no está disponible. Instalá una versión actual de Xcode o Command Line Tools.');
}

console.log('Identidad Developer ID y credenciales de notarización disponibles.');
