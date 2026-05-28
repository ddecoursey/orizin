export function fmt(v, type) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  switch (type) {
    case 'pct':   return (v * 100).toFixed(1) + '%';
    case 'money': {
      const a = Math.abs(v);
      if (a >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
      if (a >= 1e9)  return '$' + (v / 1e9).toFixed(0) + 'B';
      if (a >= 1e6)  return '$' + (v / 1e6).toFixed(0) + 'M';
      return '$' + v.toFixed(0);
    }
    case 'x':     return v.toFixed(1);
    case 'r':     return v.toFixed(1);
    case 'price': return '$' + v.toFixed(0);
    default:      return v.toFixed(2);
  }
}
