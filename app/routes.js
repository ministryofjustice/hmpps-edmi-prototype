//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

// Add your routes here

// ---- Dynamic dates for LOI table (available to all views) ----
function buildLoiRowsDates(anchorDate /* Date at 00:00 */) {
  // Offsets matching your original pattern:
  // top 4 rows = 0; then -1, -2; then 3 rows at -3; 3 rows at -4;
  // then -5; then last 3 rows at -14
  const offsets = [0,0,0,0, -1, -2, -3,-3,-3, -4,-4,-4, -5, -14,-14,-14];

  return offsets.map(off => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + off); // apply offset

    const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD

    // UK display
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const day     = d.toLocaleDateString('en-GB', { day: 'numeric' });
    const month   = d.toLocaleDateString('en-GB', { month: 'long' });
    const year    = d.toLocaleDateString('en-GB', { year: 'numeric' });

    return {
      html: `${weekday} ${day} ${month}<br/>${year}`,
      iso
    };
  });
}

// Middleware: compute loiDates for every request
router.use(function setLoiDates(req, res, next) {
  const anchor = new Date();            // today
  anchor.setHours(0,0,0,0);             // midnight
  // Or use a fixed date for demos:
  // const anchor = new Date('2025-09-01T00:00:00Z');
  res.locals.loiDates = buildLoiRowsDates(anchor);
  next();
});



router.get('/bh-location', (req, res) => {
  const d = new Date();

  // For maxDate (what the picker expects)
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const todayMax = `${dd}/${mm}/${yyyy}`;   // e.g. 21/08/2025

  // For display (your requested 21/8/25)
  const todayDisplay = `${d.getDate()}/${d.getMonth()+1}/${String(yyyy).slice(-2)}`;

  res.render('bh-location', { todayMax, todayDisplay });
});


router.get('/design-history', function (req, res) {
  res.render('design-history');
});
