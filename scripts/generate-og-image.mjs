import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Renders the social share (Open Graph / Twitter) card from public/og/og-image.svg.
// The PNG is committed and shipped as-is — it is NOT regenerated in CI — so the
// SVG's text is rasterised here using the local PT Sans font to match the brand.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ogDir = join(__dirname, '..', 'public', 'og');
const svg = readFileSync(join(ogDir, 'og-image.svg'));

await sharp(svg, { density: 160 })
  .resize(1200, 630)
  .png()
  .toFile(join(ogDir, 'og-image.png'));

console.log('✓ og-image.png (1200x630)');
