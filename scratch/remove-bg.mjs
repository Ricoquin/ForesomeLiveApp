// Remove white background from logo PNG using Canvas API
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

const INPUT = '/Users/ricoquin/Downloads/foreSomeV1App/src/assets/foresome-logo.png';
const OUTPUT = '/Users/ricoquin/Downloads/foreSomeV1App/src/assets/foresome-logo.png';

async function main() {
  const img = await loadImage(INPUT);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Threshold: pixels that are close to white become transparent
  const THRESHOLD = 230;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r > THRESHOLD && g > THRESHOLD && b > THRESHOLD) {
      data[i+3] = 0; // Set alpha to 0
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(OUTPUT, buffer);
  console.log('Done! White background removed.');
}

main().catch(console.error);
