import { useState, useRef, useEffect } from 'react';

export default function TabsBar({ tabs, activeTab, onActivate, onCreate, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  function commit() {
    const name = newName.trim();
    setAdding(false);
    setNewName('');
    if (name) onCreate(name);
  }
  function cancel() { setAdding(false); setNewName(''); }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800
      bg-gray-950 overflow-x-auto shrink-0">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onActivate(tab.id)}
          className={`flex items-center gap-1 px-3 py-1.5 lg:py-1 rounded-full text-xs font-medium
            cursor-pointer select-none transition-colors whitespace-nowrap active:scale-95
            ${tab.id === activeTab
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'
            }`}
        >
          <span>{tab.name}</span>
          {tab.id !== 'default' && (
            <button
              onClick={e => { e.stopPropagation(); if (confirm('Delete this saved screen?')) onDelete(tab.id); }}
              className="ml-0.5 -mr-1 px-1 py-0.5 opacity-60 hover:opacity-100 text-sm leading-none cursor-pointer"
            >×</button>
          )}
        </div>
      ))}

      {adding ? (
        <input
          ref={inputRef}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          onBlur={() => setTimeout(commit, 120)}
          maxLength={28}
          placeholder="Screen name…"
          className="px-3 py-1.5 lg:py-1 rounded-full text-xs bg-gray-800 border border-blue-500
            text-gray-200 outline-none w-36"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="px-3 py-1.5 lg:py-1 rounded-full text-xs font-medium text-blue-400
            border border-dashed border-blue-800 hover:bg-blue-900/30 transition-colors cursor-pointer"
        >
          + Create screen
        </button>
      )}
    </div>
  );
}
