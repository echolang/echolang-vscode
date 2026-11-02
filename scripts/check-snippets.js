// snippets/echo.json is a VS Code snippet file, where `$name` is a snippet variable. an Echo
// variable has to be written `\$name` there, or it silently expands to nothing. this fails
// the test run on any `$` followed by a letter that is not escaped.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'snippets', 'echo.json');
const snippets = JSON.parse(fs.readFileSync(file, 'utf8'));

let failures = 0;
for (const [name, snippet] of Object.entries(snippets)) {
    const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
    for (const match of body.matchAll(/(\\*)\$[A-Za-z_]/g)) {
        if (match[1].length % 2 === 0) {
            console.error(`snippets/echo.json: '${name}' has an unescaped Echo variable near '${body.slice(match.index, match.index + 12)}'`);
            failures++;
        }
    }
    if (!snippet.prefix || !snippet.description) {
        console.error(`snippets/echo.json: '${name}' needs a prefix and a description`);
        failures++;
    }
}

if (failures > 0) {
    process.exit(1);
}
console.log(`snippets/echo.json: ${Object.keys(snippets).length} snippets ok`);
