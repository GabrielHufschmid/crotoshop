import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const backend = path.join(root, 'backend');
const venv = path.join(backend, '.venv');
const isWindows = process.platform === 'win32';
const python = isWindows ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
const pyinstaller = isWindows ? path.join(venv, 'Scripts', 'pyinstaller.exe') : path.join(venv, 'bin', 'pyinstaller');
const modelUrl = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const modelMd5 = 'fc16ebd8b0c10d971d3513d564d01e29';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(python)) run(isWindows ? 'python' : 'python3', ['-m', 'venv', venv]);
const requirementsPath = path.join(backend, 'requirements.txt');
const requirementsHash = createHash('sha256').update(readFileSync(requirementsPath)).digest('hex');
const requirementsStamp = path.join(venv, '.crotoshop-requirements');
if (!existsSync(pyinstaller) || !existsSync(requirementsStamp) || readFileSync(requirementsStamp, 'utf8') !== requirementsHash) {
  run(python, ['-m', 'pip', 'install', '-r', requirementsPath]);
  writeFileSync(requirementsStamp, requirementsHash);
}

const modelHome = path.join(root, 'backend-models');
mkdirSync(modelHome, { recursive: true });
const modelPath = path.join(modelHome, 'isnet-general-use.onnx');
const validModel = existsSync(modelPath)
  && createHash('md5').update(readFileSync(modelPath)).digest('hex') === modelMd5;
if (!validModel) {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`No se pudo descargar el modelo (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('md5').update(bytes).digest('hex') !== modelMd5) throw new Error('Checksum inválido para ISNet');
  writeFileSync(modelPath, bytes);
}

const dist = path.join(root, 'backend-dist');
const work = path.join(root, 'backend-build');
const sourcePath = path.join(backend, 'crotoshop_ai.py');
const buildHash = createHash('sha256')
  .update(readFileSync(sourcePath))
  .update(readFileSync(scriptPath))
  .update(requirementsHash)
  .update(`${process.platform}:${process.arch}`)
  .digest('hex');
const buildStamp = path.join(dist, '.crotoshop-build');
const executable = path.join(dist, 'crotoshop-ai', isWindows ? 'crotoshop-ai.exe' : 'crotoshop-ai');
if (existsSync(executable) && existsSync(buildStamp) && readFileSync(buildStamp, 'utf8') === buildHash) {
  console.log('Backend de IA sin cambios; se reutiliza la compilación existente.');
  process.exit(0);
}
rmSync(dist, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
run(pyinstaller, [
  '--noconfirm', '--clean', '--onedir', '--name', 'crotoshop-ai',
  ...(isWindows ? [] : ['--strip']),
  '--exclude-module', 'tkinter',
  '--exclude-module', 'unittest',
  '--distpath', dist, '--workpath', work, '--specpath', work,
  sourcePath,
]);
writeFileSync(buildStamp, buildHash);
