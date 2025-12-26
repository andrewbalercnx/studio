/**
 * PWA Icon Generator
 * Generates PNG icons for the PWA manifest using sharp
 * Run with: node scripts/generate-pwa-icons.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// SVG template for a child-friendly star icon with StoryPic branding
function generateSVG(size) {
  const centerX = size / 2;
  const centerY = size / 2;
  const innerSize = size * 0.8;

  // Star points calculation
  const starRadius = innerSize * 0.35;
  const innerRadius = starRadius * 0.4;
  const points = 5;
  let starPath = '';

  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? starRadius : innerRadius;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    starPath += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  starPath += 'Z';

  // Book shape for the background
  const bookWidth = innerSize * 0.6;
  const bookHeight = innerSize * 0.5;
  const bookLeft = centerX - bookWidth / 2;
  const bookTop = centerY + innerSize * 0.05;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f59e0b"/>
      <stop offset="100%" style="stop-color:#ea580c"/>
    </linearGradient>
    <linearGradient id="starGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fef3c7"/>
      <stop offset="100%" style="stop-color:#fcd34d"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${size * 0.01}" stdDeviation="${size * 0.02}" flood-color="#000" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Background circle -->
  <circle cx="${centerX}" cy="${centerY}" r="${size / 2}" fill="url(#bgGradient)"/>

  <!-- Inner glow circle -->
  <circle cx="${centerX}" cy="${centerY}" r="${innerSize / 2}" fill="rgba(255,255,255,0.12)"/>

  <!-- Star with shadow -->
  <g filter="url(#shadow)">
    <path d="${starPath}" fill="url(#starGradient)"/>
  </g>

  <!-- Sparkle effects -->
  <circle cx="${centerX - innerSize * 0.28}" cy="${centerY - innerSize * 0.22}" r="${size * 0.025}" fill="#fff" opacity="0.9"/>
  <circle cx="${centerX + innerSize * 0.32}" cy="${centerY - innerSize * 0.12}" r="${size * 0.018}" fill="#fff" opacity="0.7"/>
  <circle cx="${centerX + innerSize * 0.15}" cy="${centerY + innerSize * 0.28}" r="${size * 0.02}" fill="#fff" opacity="0.8"/>
  <circle cx="${centerX - innerSize * 0.35}" cy="${centerY + innerSize * 0.1}" r="${size * 0.015}" fill="#fff" opacity="0.6"/>

  <!-- Small book icon at bottom -->
  <g transform="translate(${centerX - bookWidth/2}, ${bookTop})">
    <rect x="0" y="0" width="${bookWidth}" height="${bookHeight}" rx="${size * 0.02}" fill="#fff" opacity="0.9"/>
    <line x1="${bookWidth/2}" y1="0" x2="${bookWidth/2}" y2="${bookHeight}" stroke="#f59e0b" stroke-width="${size * 0.01}" opacity="0.5"/>
    <rect x="${bookWidth * 0.15}" y="${bookHeight * 0.2}" width="${bookWidth * 0.3}" height="${size * 0.01}" fill="#f59e0b" opacity="0.6" rx="${size * 0.005}"/>
    <rect x="${bookWidth * 0.15}" y="${bookHeight * 0.4}" width="${bookWidth * 0.25}" height="${size * 0.01}" fill="#f59e0b" opacity="0.4" rx="${size * 0.005}"/>
    <rect x="${bookWidth * 0.55}" y="${bookHeight * 0.2}" width="${bookWidth * 0.3}" height="${size * 0.01}" fill="#f59e0b" opacity="0.6" rx="${size * 0.005}"/>
    <rect x="${bookWidth * 0.55}" y="${bookHeight * 0.4}" width="${bookWidth * 0.2}" height="${size * 0.01}" fill="#f59e0b" opacity="0.4" rx="${size * 0.005}"/>
  </g>
</svg>`;
}

async function generateIcons() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Generating PWA icons...\n');

  for (const size of ICON_SIZES) {
    const svg = generateSVG(size);
    const svgBuffer = Buffer.from(svg);

    // Generate PNG
    const pngPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`  ✓ Created: icon-${size}x${size}.png`);
  }

  // Also create an apple-touch-icon
  const appleSvg = generateSVG(180);
  await sharp(Buffer.from(appleSvg))
    .resize(180, 180)
    .png()
    .toFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'));
  console.log('  ✓ Created: apple-touch-icon.png');

  // Create favicon
  const faviconSvg = generateSVG(32);
  await sharp(Buffer.from(faviconSvg))
    .resize(32, 32)
    .png()
    .toFile(path.join(OUTPUT_DIR, 'favicon-32x32.png'));
  console.log('  ✓ Created: favicon-32x32.png');

  const favicon16Svg = generateSVG(16);
  await sharp(Buffer.from(favicon16Svg))
    .resize(16, 16)
    .png()
    .toFile(path.join(OUTPUT_DIR, 'favicon-16x16.png'));
  console.log('  ✓ Created: favicon-16x16.png');

  console.log('\n✅ All PWA icons generated successfully!');
  console.log(`   Location: ${OUTPUT_DIR}\n`);
}

generateIcons().catch(console.error);
