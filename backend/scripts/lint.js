const fs = require('fs');
const path = require('path');

const targets = [
  path.resolve(__dirname, '../src/app.js'),
  path.resolve(__dirname, '../src/data/mysqlStore.js'),
  path.resolve(__dirname, '../src/data/mockDb.js')
];

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.includes('\t')) {
    throw new Error(`${filePath}: contains tab characters, use spaces`);
  }
  if (/[ \t]+$/m.test(text)) {
    throw new Error(`${filePath}: contains trailing whitespace`);
  }
}

function main() {
  targets.forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`${filePath}: file not found`);
    }
    checkFile(filePath);
  });
  console.log('[lint] basic checks passed');
}

main();
