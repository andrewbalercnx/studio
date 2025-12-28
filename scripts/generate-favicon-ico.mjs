import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');
const appDir = join(__dirname, '..', 'src', 'app');

async function generateFaviconIco() {
  console.log('Generating favicon.ico...\n');

  // Read the PNG files for multi-resolution ICO
  const png16 = readFileSync(join(iconsDir, 'favicon-16x16.png'));
  const png32 = readFileSync(join(iconsDir, 'favicon-32x32.png'));

  // Generate ICO with multiple sizes
  const icoBuffer = await pngToIco([png16, png32]);

  // Write to src/app/favicon.ico (Next.js convention)
  const faviconPath = join(appDir, 'favicon.ico');
  writeFileSync(faviconPath, icoBuffer);

  console.log(`✓ Generated favicon.ico at src/app/favicon.ico`);
}

generateFaviconIco().catch(console.error);
