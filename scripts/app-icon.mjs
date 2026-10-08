// The app's icon for Xcode, from public/icon.svg: 1024 px, square and opaque (iOS rounds the
// corners itself and refuses transparency). Run after changing the icon: `node scripts/app-icon.mjs`.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = (await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8')).replace(/\srx="[^"]*"/, '');
await sharp(Buffer.from(svg), { density: 1200 }).resize(1024, 1024).flatten({ background: '#0E7C74' }).png()
  .toFile(new URL('../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url).pathname);
console.log('ios app icon written');
