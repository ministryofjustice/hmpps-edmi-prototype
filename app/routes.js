//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

// Add your routes here
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