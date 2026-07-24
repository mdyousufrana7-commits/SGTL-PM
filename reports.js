// reports.js — builds a CSV report for a project: material summary
// (planned / used / remaining) plus the full dated usage log.
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function row(cells) { return cells.map(csvEscape).join(','); }

function materialUsageCsv(project, materials, usageRows) {
  const lines = [];
  lines.push(row(['Project', project.name]));
  lines.push(row(['Client', project.client_name || '']));
  lines.push(row(['Location', project.location || '']));
  lines.push(row(['Generated', new Date().toISOString().slice(0, 19).replace('T', ' ')]));
  lines.push('');

  lines.push('MATERIAL SUMMARY');
  lines.push(row(['Material', 'Unit', 'Planned Quantity', 'Total Used', 'Remaining Quantity']));
  materials.forEach(m => {
    lines.push(row([m.name, m.unit, m.planned_quantity, m.total_used, m.remaining_quantity]));
  });
  lines.push('');

  lines.push('DAILY USAGE LOG');
  lines.push(row(['Date', 'Material', 'Unit', 'Quantity Used', 'Remarks', 'Logged By']));
  usageRows.forEach(u => {
    lines.push(row([u.usage_date, u.material_name || '', u.unit || '', u.quantity_used, u.remarks || '', u.logged_by || '']));
  });

  return lines.join('\n');
}

module.exports = { materialUsageCsv };
