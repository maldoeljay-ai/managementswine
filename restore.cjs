const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/PC/.gemini/antigravity-ide/brain/923cf541-9522-4e7e-969a-a69ae852b891/.system_generated/logs/transcript_full.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lastCode = '';
  for await (const line of rl) {
    if (line.includes('export const DISEASE_DATASET = [')) {
      try {
        const obj = JSON.parse(line);
        if (obj.tool_calls) {
          for (const tc of obj.tool_calls) {
            if (tc.name === 'default_api:write_to_file') {
              if (tc.arguments.TargetFile && tc.arguments.TargetFile.endsWith('aiService.js')) {
                lastCode = tc.arguments.CodeContent;
              }
            }
          }
        }
      } catch(e) {}
    }
  }

  if (lastCode) {
    fs.writeFileSync('c:/Users/PC/Downloads/Swine__/Swine__-main/src/services/aiService.js', lastCode);
    console.log('RESTORED');
  } else {
    console.log('NOT FOUND');
  }
}
processLineByLine();
