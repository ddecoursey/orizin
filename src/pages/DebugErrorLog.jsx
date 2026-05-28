import { useState, useEffect } from 'react';

export default function DebugErrorLog() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    document.title = 'Debug • Orizen';
  }, []);

  const fetchErrors = async () => {
    try {
      setFetchError(null);
      const res = await fetch('/api/debug/errors?limit=200');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setErrors(data.errors || []);
      setLastUpdated(new Date());
    } catch (e) {
      setFetchError(e.message || 'Failed to connect to backend');
      console.error('Failed to fetch error logs', e);
    } finally {
      setLoading(false);
    }
  };

  const clearErrors = async () => {
    // Simple client-side clear (we can enhance later with a backend clear endpoint)
    setErrors([]);
  };

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 3000); // auto-refresh every 3s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Error Log</h1>
            <p className="text-gray-400 text-sm mt-1">
              Real-time errors from the application (auto-refreshes every 3s)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-500">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={clearErrors}
              className="px-4 py-2 text-sm rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              Clear View
            </button>
            <button
              onClick={fetchErrors}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500"
            >
              Refresh Now
            </button>
          </div>
        </div>

        {fetchError ? (
          <div className="bg-red-950 border border-red-800 rounded-lg p-6">
            <p className="text-red-400 font-medium">Could not load error logs</p>
            <p className="text-red-300 mt-1 text-sm">{fetchError}</p>
          </div>
        ) : loading && errors.length === 0 ? (
          <div className="text-gray-400">Loading errors...</div>
        ) : errors.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">No errors logged yet.</p>
            <p className="text-sm text-gray-500 mt-2">
              Errors from enrichment, FMP calls, and frontend will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-48">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium">Error Message</th>
                  <th className="text-left px-4 py-3 font-medium w-64">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 font-mono text-xs">
                {errors.map((err, index) => (
                  <tr key={index} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(err.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-red-400 break-words">
                      {err.message}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {err.symbol && <div>Symbol: {err.symbol}</div>}
                      {Object.keys(err).length > 2 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-600 hover:text-gray-400">More details</summary>
                          <pre className="mt-1 text-[10px] bg-gray-950 p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(err, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          This page is only for debugging. Errors are stored in memory on the backend (last 200).
        </div>
      </div>
    </div>
  );
}
