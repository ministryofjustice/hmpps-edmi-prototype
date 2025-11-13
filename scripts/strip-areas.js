const fs = require('fs');
const inPath  = 'app/assets/data/gps-traces-bh-demo-nov01.json';
const outPath = 'app/assets/data/gps-traces-bh-demo-nov01.json';

const json = JSON.parse(fs.readFileSync(inPath, 'utf8'));
for (const k of Object.keys(json)) {
  if (json[k] && Array.isArray(json[k].areas)) {
    json[k].areas = json[k].areas.filter(a => a.label !== 'Home vicinity');
  }
}
fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
console.log('✅ Stripped “Home vicinity” polygons.');
