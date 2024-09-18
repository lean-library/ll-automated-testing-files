const fs = require('fs');

// Path to the text file you want to read
const filePath: string = './tests/e2e/test-report-json/results.json';

// Function to read the file line by line
function readLines(filePath: string, lineCallback: (line: string) => void, errorCallback: (error: Error) => void) {
  const readStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let remaining: any;

  readStream.on('data', function (chunk: any) {
    remaining += chunk;
    let lines = remaining.split('\n');
    remaining = lines.pop() ? lines.pop() : '';

    lines.forEach((line: any) => {
      lineCallback(line);
    });
  });

  readStream.on('end', function () {
    if (remaining) {
      lineCallback(remaining);
    }
  });

  readStream.on('error', function (err: Error) {
    errorCallback(err);
  });
}

const FEATURE_NAMES = [
  "performance",
  "access",
  "alternatives",
  "citation",
  "config",
  "futuresNotifications",
  "futuresOther",
  "futuresServices",
  "generalNotifications",
  "generalOther",
  "integration",
  "options",
  "settingsNotifications",
  "settingsOther"
]

const STEP_TYPES = [
  'GIVEN',
  'WHEN',
  'THEN',
  'AND',
]

// Callback function to handle each line
function processLine(line: any) {
  let trimLine = '';
  trimLine = line.trim();
  FEATURE_NAMES.forEach((feature) => {
    if (trimLine.includes(`features/${feature}`)) {
      console.log(`FEATURE: ${feature}`);
      // remove the feature from the array
      FEATURE_NAMES.splice(FEATURE_NAMES.indexOf(feature), 1);
    }
  });
  if (trimLine.includes('Scenario: ')) {
    trimLine = trimLine.replace('"text": "', '').replace('\\n"', '');
    console.log(trimLine);
  }
  STEP_TYPES.forEach((stepType) => {
    if (trimLine.includes(`"${stepType}`)) {
      trimLine = trimLine.replace('"title": "', '').replace('",', '');
      console.log(`* ${trimLine}`);
    }
  });
  // if (trimLine.includes('Log: ')) {
  //   trimLine = trimLine.replace('"title": "Log: ', '').replace('",', '');
  //   console.log(`> ${trimLine}`);
  // }
}

// Callback function to handle errors
function handleError(error: Error) {
  console.error('Error:', error);
}

// Call the function to read lines from the file
new Promise(() => {
  readLines(filePath, processLine, handleError);
});
