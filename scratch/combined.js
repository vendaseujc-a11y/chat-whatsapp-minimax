const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\home\\Documents\\pasta opensquad\\squads\\chat whats app\\index.html';
let html = fs.readFileSync(filePath, 'utf8');

// Replace everything from <style> to </header>
const startTag = '<style>';
const endTag = '</header>';

const startIndex = html.indexOf(startTag);
const endIndex = html.indexOf(endTag);

if (startIndex === -1 || endIndex === -1) {
    console.error('Tags not found');
    process.exit(1);
}

const newStyleAndHeader = "");

// Write back
const newHtml = html.substring(0, startIndex) + newStyleAndHeader + html.substring(endIndex + endTag.length);
fs.writeFileSync(filePath, newHtml, 'utf8');
console.log('Successfully replaced stylesheet and header');
