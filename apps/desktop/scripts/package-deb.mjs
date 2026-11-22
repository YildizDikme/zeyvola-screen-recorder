#!/usr/bin/env node
// Builds a Debian/Ubuntu (.deb) package of Zeyvola for Linux (amd64 or arm64).
//
//   node apps/desktop/scripts/package-deb.mjs [--arch x64|arm64] [--skip-build] [--out <dir>]
//
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const root = resolve(appDir, '..', '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const arch = arg('arch', process.arch === 'x64' ? 'x64' : process.arch);
if (!['x64', 'arm64'].includes(arch)) throw new Error('--arch x64 | arm64');
const debArch = arch === 'x64' ? 'amd64' : 'arm64';

const { artifact, cached, extractZip, ELECTRON_VERSION } = await import(
  pathToFileURL(join(root, 'tools', 'electron-artifacts.mjs')).href
);
const { writeDist } = await import(pathToFileURL(join(root, 'tools', 'third-party-notices.mjs')).href);

const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
const version = pkg.version;
const outDir = resolve(arg('out', join(appDir, 'out', 'deb')));
mkdirSync(outDir, { recursive: true });

const debFileName = `zeyvola_${version}_${debArch}.deb`;
const debPath = join(outDir, debFileName);

console.log(`Bileşenler hazırlanıyor: Zeyvola ${version} (.deb ${debArch})...`);

// 1) Build the desktop app
if (!process.argv.includes('--skip-build')) {
  console.log('Uygulama derleniyor (pnpm build)...');
  execFileSync('pnpm', ['run', 'build'], { cwd: appDir, stdio: 'inherit' });
}

// 2) Official artifacts
const zip = async (spec) => cached(spec) ?? artifact(spec);
const electronZip = await zip(`electron:linux:${arch}`);
const ffmpegZip = await zip(`ffmpeg:linux:${arch}`);
if (!electronZip) throw new Error(`Electron zip bulunamadı: electron:linux:${arch}`);
if (!ffmpegZip) throw new Error(`FFmpeg zip bulunamadı: ffmpeg:linux:${arch}`);

// 3) Create staging layout
const stage = mkdtempSync(join(tmpdir(), 'zeyvola-deb-'));
chmodSync(stage, 0o755);
const optDir = join(stage, 'opt', 'zeyvola');
const binDir = join(stage, 'usr', 'bin');
const appsDir = join(stage, 'usr', 'share', 'applications');
const debianDir = join(stage, 'DEBIAN');

mkdirSync(optDir, { recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(appsDir, { recursive: true });
mkdirSync(debianDir, { recursive: true });
chmodSync(debianDir, 0o755);

// Unpack electron into /opt/zeyvola
console.log('Electron ikilileri açılıyor...');
extractZip(electronZip, optDir);

// Replace ffmpeg with the official build without proprietary codecs
const ffmpegWork = mkdtempSync(join(tmpdir(), 'zeyvola-deb-ffmpeg-'));
extractZip(ffmpegZip, ffmpegWork);
cpSync(join(ffmpegWork, 'libffmpeg.so'), join(optDir, 'libffmpeg.so'));
rmSync(ffmpegWork, { recursive: true, force: true });

// Rename electron binary to zeyvola
renameSync(join(optDir, 'electron'), join(optDir, 'zeyvola'));
chmodSync(join(optDir, 'zeyvola'), 0o755);

// Ensure chrome-sandbox exists with proper mode
if (existsSync(join(optDir, 'chrome-sandbox'))) {
  chmodSync(join(optDir, 'chrome-sandbox'), 0o4755);
}

// Remove default_app.asar
const resources = join(optDir, 'resources');
rmSync(join(resources, 'default_app.asar'), { force: true });

// Copy bundled app into resources/app
const appResources = join(resources, 'app');
mkdirSync(appResources, { recursive: true });
writeFileSync(
  join(appResources, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.productName,
      version: pkg.version,
      description: pkg.description,
      main: pkg.main,
      private: true,
    },
    null,
    2
  )}\n`
);
cpSync(join(appDir, 'dist'), join(appResources, 'dist'), {
  recursive: true,
  filter: (src) => !src.endsWith('.map'),
});

// Write notices and licenses
console.log('Lisans ve dağıtım bildirimleri oluşturuluyor...');
const { problems } = writeDist(join(appResources, 'dist'), root, {
  electronDist: optDir,
  profile: 'mp4',
  platform: 'linux',
});
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  throw new Error('Lisans bildirimleri eksik; paket tamamlanmadı');
}

cpSync(join(appResources, 'dist', 'licenses'), join(resources, 'licenses'), { recursive: true });
copyFileSync(join(root, 'LICENSE'), join(optDir, 'LICENSE.md'));
copyFileSync(join(root, 'NOTICE'), join(optDir, 'NOTICE.txt'));
copyFileSync(join(root, 'README.md'), join(optDir, 'README.md'));
writeFileSync(
  join(resources, 'licenses', 'DISTRIBUTION.json'),
  `${JSON.stringify(
    {
      app: pkg.version,
      profile: 'mp4',
      platform: 'linux',
      arch,
      electron: ELECTRON_VERSION,
      ffmpeg: 'electron-official-without-proprietary-codecs',
    },
    null,
    1
  )}\n`
);

// 4) Launcher script in /usr/bin/zeyvola
const launcherPath = join(binDir, 'zeyvola');
writeFileSync(
  launcherPath,
  `#!/bin/sh
exec /opt/zeyvola/zeyvola "$@"
`
);
chmodSync(launcherPath, 0o755);

// 5) Desktop entry in /usr/share/applications/zeyvola.desktop
const desktopEntry = `[Desktop Entry]
Name=Zeyvola
Comment=Screen recording and video editing
Exec=/opt/zeyvola/zeyvola %U
Terminal=false
Type=Application
Icon=zeyvola
StartupWMClass=Zeyvola
Categories=AudioVideo;Recorder;Video;AudioVideoEditing;
MimeType=application/x-zeyvola-project;
`;
writeFileSync(join(appsDir, 'zeyvola.desktop'), desktopEntry);
chmodSync(join(appsDir, 'zeyvola.desktop'), 0o644);

// 6) Generate application icons for hicolor theme
console.log('Uygulama simgeleri oluşturuluyor...');
const req = createRequire(join(appDir, 'package.json'));
const esbuild = req('esbuild');
const res = esbuild.buildSync({
  entryPoints: [join(appDir, 'src', 'main', 'png.ts')],
  write: false,
  format: 'cjs',
});
const tmpIconJs = join(tmpdir(), `zeyvola-icon-${Date.now()}.cjs`);
writeFileSync(tmpIconJs, res.outputFiles[0].text);
const { appIcon } = req(tmpIconJs);
rmSync(tmpIconJs, { force: true });

for (const size of [512, 256, 128, 64, 48, 32]) {
  const iconDir = join(stage, 'usr', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps');
  mkdirSync(iconDir, { recursive: true });
  writeFileSync(join(iconDir, 'zeyvola.png'), appIcon(size));
}

// 7) Calculate Installed-Size in KB
let installedSizeBytes = 0;
function walkSize(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSize(full);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      installedSizeBytes += statSync(full).size;
    }
  }
}
walkSize(stage);
const installedSizeKb = Math.ceil(installedSizeBytes / 1024);

// 8) Write DEBIAN/control
const control = `Package: zeyvola
Version: ${version}
Section: video
Priority: optional
Architecture: ${debArch}
Maintainer: ${pkg.author}
Installed-Size: ${installedSizeKb}
Depends: libasound2, libatk-bridge2.0-0, libatk1.0-0, libc6, libcairo2, libcups2, libdbus-1-3, libexpat1, libfontconfig1, libgbm1, libgcc1, libglib2.0-0, libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libpangocairo-1.0-0, libstdc++6, libx11-6, libx11-xcb1, libxcb1, libxcomposite1, libxcursor1, libxdamage1, libxext6, libxfixes3, libxi6, libxrandr2, libxrender1, libxss1, libxtst6
Description: Screen recording and video editing
 Record your screen, camera and microphone separately - then shape the video afterwards:
 automatic zoom from your clicks, privacy masks, camera layout and vertical formats, all on your own computer.
`;
writeFileSync(join(debianDir, 'control'), control);
chmodSync(join(debianDir, 'control'), 0o644);

// 9) Normalize directory & file permissions
function normalizePerms(dir) {
  chmodSync(dir, 0o755);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      normalizePerms(full);
    } else if (entry.isFile()) {
      if (entry.name === 'chrome-sandbox') {
        chmodSync(full, 0o4755);
      } else if (entry.name === 'zeyvola' || entry.name.endsWith('.so') || entry.name.endsWith('.so.1') || entry.name === 'chrome_crashpad_handler') {
        chmodSync(full, 0o755);
      } else {
        chmodSync(full, 0o644);
      }
    }
  }
}
normalizePerms(stage);

// 10) Build the .deb using dpkg-deb
console.log(`Paket üretiliyor: ${debPath}...`);
execFileSync('dpkg-deb', ['--build', '--root-owner-group', stage, debPath], { stdio: 'inherit' });

// Cleanup staging directory
rmSync(stage, { recursive: true, force: true });

// 10) Summary and checksum
const debSize = statSync(debPath).size;
const debSha = createHash('sha256').update(readFileSync(debPath)).digest('hex');

console.log('\n========================================');
console.log('✓ .deb paketi başarıyla üretildi!');
console.log(`Dosya: ${debPath}`);
console.log(`Boyut: ${(debSize / (1024 * 1024)).toFixed(2)} MB (${debSize} bytes)`);
console.log(`SHA-256: ${debSha}`);
console.log('========================================\n');

// Verify package contents
execFileSync('dpkg-deb', ['-I', debPath], { stdio: 'inherit' });
