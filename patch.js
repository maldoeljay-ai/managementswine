const fs = require('fs');

const path = 'src/components/Fatteners.jsx';
let c = fs.readFileSync(path, 'utf8');

c = c.replace(
  'text: "This will remove the fattener from the active list.",',
  'text: "Please enter the sale price (amount of money earned) below:",\n                                input: \\'number\\',\n                                inputPlaceholder: \\'e.g. 15000\\','
);

const newLogic = \`const salePrice = parseFloat(result.value) || 0;
                                  await dataAPI.pigs.update(pig.id, { ...pig, status: 'sold', sold_price: salePrice });
                                  
                                  if (salePrice > 0) {
                                    await dataAPI.financial_transactions.insert({
                                      type: 'revenue',
                                      amount: salePrice,
                                      description: \\\`Sold Fattener: \\\${pig.tag}\\\`,
                                      category: 'Pig Sales',
                                      date: new Date().toISOString()
                                    });
                                  }\`;

c = c.replace(
  "await dataAPI.pigs.update(pig.id, { ...pig, status: 'sold' });",
  newLogic
);

// Add the totalSales calculation
if (!c.includes('const totalSales = pigs')) {
  c = c.replace(
    '  return (\\n    <div className="card"',
    \`  const totalSales = pigs
    .filter(p => p.reproductive_status === 'Fattener' && p.status === 'sold')
    .reduce((sum, p) => sum + (parseFloat(p.sold_price) || 0), 0);

  return (
    <div className="card"\`
  );
}

// Add the metric UI
if (!c.includes('Total Sold</p>')) {
  c = c.replace(
    \`        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => {\`,
    \`        <div style={{ background: 'linear-gradient(135deg, #dcfce7, #d1fae5)', padding: '10px 16px', borderRadius: 12, border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', marginRight: 12 }}>
          <div style={{ background: '#10b981', color: 'white', borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="fas fa-dollar-sign"></i>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: '#065f46', fontWeight: 700, textTransform: 'uppercase' }}>Total Sold</p>
            <p style={{ margin: 0, fontSize: 18, color: '#047857', fontWeight: 900 }}>₱{totalSales.toLocaleString()}</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => {\`
  );
}

fs.writeFileSync(path, c, 'utf8');
console.log('Patched Fatteners.jsx successfully.');
