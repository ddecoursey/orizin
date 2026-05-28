export function fmt(v, type) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  switch (type) {
    case 'pct':   return (v * 100).toFixed(1) + '%';
    case 'r40':   return v.toFixed(0); // Rule of 40 — already a percentage score
    case 'money': {
      const a = Math.abs(v);
      if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
      if (a >= 1e6)  return '$' + (v / 1e6).toFixed(0) + 'M';
      return '$' + v.toFixed(0);
    }
    case 'x':     return v.toFixed(1) + '×';
    case 'ratio': return v.toFixed(2);
    case 'price': return '$' + v.toFixed(2);
    default:      return v.toFixed(2);
  }
}

export function fmtAge(ms) {
  if (ms < 60000)    return 'just now';
  if (ms < 3600000)  return Math.round(ms / 60000) + 'min ago';
  if (ms < 86400000) return Math.round(ms / 3600000) + 'h ago';
  return Math.round(ms / 86400000) + 'd ago';
}

export function fmtNum(v, type) {
  const s = fmt(v, type);
  return s ?? '—';
}
