import fs from 'fs';
import path from 'path';

const mainHtmlPath = '/Users/ricoquin/Downloads/foreSomeV1App/main.html';
const globalCssPath = '/Users/ricoquin/Downloads/foreSomeV1App/src/global.css';

try {
  console.log('Reading main.html...');
  const htmlContent = fs.readFileSync(mainHtmlPath, 'utf8');
  
  console.log('Extracting CSS contents...');
  const styleStartTag = '<style>';
  const styleEndTag = '</style>';
  
  const startIndex = htmlContent.indexOf(styleStartTag);
  const endIndex = htmlContent.indexOf(styleEndTag);
  
  if (startIndex === -1 || endIndex === -1) {
    console.error('Error: Could not find <style> or </style> tags in main.html');
    process.exit(1);
  }
  
  const cssContent = htmlContent.substring(startIndex + styleStartTag.length, endIndex);
  
  console.log(`Writing ${cssContent.length} bytes of CSS to src/global.css...`);
  fs.writeFileSync(globalCssPath, cssContent, 'utf8');
  console.log('CSS extraction completed successfully!');
} catch (err) {
  console.error('Error during CSS extraction:', err);
  process.exit(1);
}
