// Test timezone conversion logic
const timestamps = [
  '2026-01-08T14:25:08.666+0100',  // PRC-30682
  '2026-01-08T16:30:00.000+0100',  // PRC-30153  
  '2026-01-08T15:14:00.034+0100',  // PRC-30153
];

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

console.log('Testing timezone conversion:\n');
timestamps.forEach(ts => {
  const d = new Date(ts);
  const formatted = fmt.format(d);
  console.log(`${ts}`);
  console.log(`  → Date object: ${d.toISOString()}`);
  console.log(`  → Formatted (Asia/Kolkata): ${formatted}`);
  console.log();
});
