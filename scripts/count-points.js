// scripts/count-points.js
const fs = require('fs');
const path = 'app/assets/data/gps-traces-bh-demo-nov01.json';

const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const counts = Object.entries(data).map(([k, v]) => ({
  day: k,
  points: (v.points || []).length
}));

console.table(counts);

const total = counts.reduce((sum, c) => sum + c.points, 0);
console.log(`Total points across ${counts.length} days: ${total}`);
const avg = total / counts.length;
console.log(`Average points per day: ${Math.round(avg)}`);
