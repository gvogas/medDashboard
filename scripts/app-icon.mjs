// The app's icon and launch screen for Xcode, from public/icon.svg: 1024 px, square and opaque (iOS rounds the
// corners itself and refuses transparency). Run after changing the icon: `node scripts/app-icon.mjs`.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = (await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8')).replace(/\srx="[^"]*"/, '');
await sharp(Buffer.from(svg), { density: 1200 }).resize(1024, 1024).flatten({ background: '#0E7C74' }).png()
  .toFile(new URL('../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url).pathname);
console.log('ios app icon written');

// The launch screen: the icon's colour with its letter in the middle, light and dark alike.
const splash = svg.replace('viewBox="0 0 64 64"', 'viewBox="-80 -80 224 224"').replace(/<rect [^>]*\/>/, '<rect x="-80" y="-80" width="224" height="224" fill="#0E7C74"/>');
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await sharp(Buffer.from(splash), { density: 1200 }).resize(2732, 2732).flatten({ background: '#0E7C74' }).png()
    .toFile(new URL(`../ios/App/App/Assets.xcassets/Splash.imageset/${name}`, import.meta.url).pathname);
}
console.log('ios launch screen written');
