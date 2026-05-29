import fs from 'fs';

const mainHtmlPath = '/Users/ricoquin/Downloads/foreSomeV1App/main.html';
const outputHtmlPath = '/Users/ricoquin/Downloads/foreSomeV1App/scratch/extracted-body.html';

try {
  console.log('Reading main.html...');
  const htmlContent = fs.readFileSync(mainHtmlPath, 'utf8');
  
  console.log('Extracting HTML body...');
  const bodyStartTag = '<div class="stage" id="stage">';
  const bodyEndTag = '<!-- ============== SCRIPTS ============== -->';
  
  const startIndex = htmlContent.indexOf(bodyStartTag);
  let endIndex = htmlContent.indexOf(bodyEndTag);
  
  if (endIndex === -1) {
    endIndex = htmlContent.indexOf('<script>');
  }
  
  if (startIndex === -1 || endIndex === -1) {
    console.error('Error: Could not find body markers');
    process.exit(1);
  }
  
  const bodyContent = htmlContent.substring(startIndex, endIndex);
  
  fs.writeFileSync(outputHtmlPath, bodyContent, 'utf8');
  console.log(`Extracted HTML saved to ${outputHtmlPath}`);
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
