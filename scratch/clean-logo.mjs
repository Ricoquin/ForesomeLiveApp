// Clean up white fringe pixels from the logo PNG
// Uses raw pixel manipulation via Canvas API
import { readFileSync, writeFileSync } from 'fs';

const INPUT = '/Users/ricoquin/Downloads/foreSomeV1App/src/assets/foresome-logo.png';
const OUTPUT = INPUT;

async function main() {
  // Dynamic import for canvas
  const { createCanvas, loadImage } = await import('canvas');
  
  const img = await loadImage(INPUT);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Remove white/near-white fringe pixels
  // Also remove semi-transparent white halos
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    
    // Fully transparent - skip
    if (a === 0) continue;
    
    // Near-white pixels (R,G,B all > 200) → make transparent
    if (r > 200 && g > 200 && b > 200) {
      data[i+3] = 0;
      continue;
    }
    
    // Light gray fringe (R,G,B all > 160) → make transparent
    if (r > 160 && g > 160 && b > 160 && a < 255) {
      data[i+3] = 0;
      continue;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(OUTPUT, buffer);
  console.log(`Done! Cleaned ${img.width}x${img.height} logo.`);
}

main().catch(e => {
  console.error('Canvas not available, trying alternative approach...');
  console.error(e.message);
  
  // Fallback: just strip white using raw PNG manipulation isn't practical
  // Let's just note it needs the canvas package
  console.log('Install canvas: npm install canvas');
});
