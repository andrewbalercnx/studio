import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconSvg = readFileSync(join(root, 'public', 'icons', 'magical-book.svg'));
const foregroundSvg = readFileSync(join(root, 'mobile', 'assets', 'mark-foreground.svg'));
const assets = join(root, 'mobile', 'assets');

// icon.png + splash-icon.png: the full gradient brand icon; adaptive foreground: mark on transparent.
const jobs = [
  { svg: iconSvg, name: 'icon.png', size: 1024 },
  { svg: iconSvg, name: 'splash-icon.png', size: 1024 },
  { svg: iconSvg, name: 'favicon.png', size: 48 },
  { svg: foregroundSvg, name: 'adaptive-icon.png', size: 1024 },
];

for (const { svg, name, size } of jobs) {
  await sharp(svg).resize(size, size).png().toFile(join(assets, name));
  console.log(`✓ ${name} (${size}x${size})`);
}
console.log('\n✓ Mobile icons generated.');
