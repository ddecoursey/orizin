export default function NotificationHost({ alerts = [], onDismiss, onOpenSymbol }) {
  if (!alerts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
      {alerts.slice(0, 3).map((a) => (
        <div
          key={a.id}
          className="pointer-events-auto rounded-lg border border-gray-700 bg-gray-950/95 shadow-xl px-3.5 py-2.5 oz-pane-in"
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenSymbol?.(a.symbol)}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <div className="text-[11px] font-bold text-gray-100 truncate">{a.title}</div>
              {a.message && (
                <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{a.message}</div>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDismiss?.(a.id)}
              className="text-gray-600 hover:text-gray-300 text-sm shrink-0 cursor-pointer"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          {a.type === "news" && a.url && (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-violet-400 hover:text-violet-300 mt-1 inline-block"
            >
              Read article →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}