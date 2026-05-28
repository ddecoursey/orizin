export default function ProgressBar({ progress, label, onCancel }) {
  if (!progress) return null;
  const { done, total, errors } = progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
          style={{ width: pct + '%' }}/>
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap font-mono">
        {done} / {total ?? '…'}
        {errors > 0 && <span className="text-red-400 ml-1">({errors} err)</span>}
      </span>
      {onCancel && (
        <button
          onClick={onCancel}
          className="ml-2 px-2.5 py-0.5 text-xs font-medium bg-red-900/70 hover:bg-red-800 text-red-200 rounded border border-red-800/60 transition-colors"
        >
          Stop
        </button>
      )}
    </div>
  );
}
