const fs = require('fs');
const text = fs.readFileSync('transcript_matches.txt', 'utf8');
const lines = text.split('\n');
let lastCode = '';

for (const line of lines) {
  if (line.includes('export const DISEASE_DATASET = [')) {
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        for (const tc of obj.tool_calls) {
          if (tc.name === 'default_api:write_to_file' || tc.name === 'default_api:replace_file_content') {
            if (tc.arguments && tc.arguments.TargetFile && tc.arguments.TargetFile.endsWith('aiService.js')) {
              lastCode = tc.arguments.CodeContent || tc.arguments.ReplacementContent;
            }
          }
        }
      } else if (obj.content && obj.content.includes('export const DISEASE_DATASET = [')) {
         // The user sent it in prompt? Let's extract from obj.content
         const match = obj.content.match(/```js\n([\s\S]*?)```/);
         if (match) {
             lastCode = match[1];
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
