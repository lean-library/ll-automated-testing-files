import fs from 'fs';
import path from 'path';

// command to run
// npx ts-node ./playwright/commands/extractScenarios/extract.ts

const searchDirectory = (dir: string, searchStrings: string[]) => {
  let currentBackground = '';

  fs.readdir(dir, { withFileTypes: true }, (err, files) => {
    if (err) {
      console.error('Error reading directory', err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(dir, file.name);
      if (file.isDirectory()) {
        searchDirectory(filePath, searchStrings); // Recursively search in subdirectory
      } else {
        fs.readFile(filePath, 'utf8', (err, content) => {
          if (err) {
            console.error(`Error reading file: ${filePath}`, err);
            return;
          }

          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (searchStrings.some((searchString) => line.includes(searchString))) {
              if (line.includes('Background:')) {
                currentBackground = line.replace('Background:', '').trim();
              } else {
                // console.log(`${currentBackground} ${line.replace('Scenario:', '').replace('Scenario Outline:', '').trim()}`);
                // console.log(currentBackground);
                // console.log(line.replace('Scenario:', '').replace('Scenario Outline:', '').trim());
                // console.log(`${filePath.split('/')[3]} - ${filePath.split('/')[4].replace('.feature', '')}`);;
                console.log(`"${currentBackground} --- ${line.replace('Scenario:', '').replace('Scenario Outline:', '').trim()} --- ${filePath.split('/')[2]} - ${filePath.split('/')[3].replace('.feature', '')}",`);
              }
            }
          });
        });
      }
    });
  });
};

const directoryPath = './playwright/features';
const searchStrings = [
  'Background:',
  'Scenario:',
  'Scenario Outline:',
];

searchDirectory(directoryPath, searchStrings);
