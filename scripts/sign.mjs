#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');

const keyPathArg = process.argv[2];
if (!keyPathArg) {
  console.error('Usage: node scripts/sign.mjs <path-to-privatekey.pem>');
  process.exit(1);
}

const keyPath = path.resolve(pkgDir, keyPathArg);
const distPath = path.join(pkgDir, 'dist');

const chromePath =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'google-chrome';

const build = spawn('pnpm', ['build'], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: true,
});

build.on('close', (code) => {
  if (code !== 0) process.exit(code);
  const chrome = spawn(chromePath, [
    `--pack-extension=${distPath}`,
    `--pack-extension-key=${keyPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], {
    stdio: 'inherit',
    shell: false,
  });
  chrome.on('close', (chromeCode) => process.exit(chromeCode ?? 0));
});
