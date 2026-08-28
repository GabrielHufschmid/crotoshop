import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icons';

interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function CommandPalette({ onClose, commands }: { onClose: () => void; commands: Command[] }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalize(query);
  const items = useMemo(
    () => commands.filter((command) => normalize(command.label).includes(normalizedQuery)).slice(0, 12),
    [commands, normalizedQuery],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { setActiveIndex(0); }, [query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return <div className="command-backdrop" data-ui onPointerDown={onClose}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Comandos" onPointerDown={(event) => event.stopPropagation()}>
      <div className="command-search"><Icon name="command" size={17} /><input
        autoFocus
        aria-label="Buscar comando"
        aria-controls="command-results"
        aria-activedescendant={items[activeIndex] ? `command-${activeIndex}` : undefined}
        placeholder="Buscar comando"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(items.length - 1, index + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); run(items[activeIndex]); }
        }}
      /></div>
      <div className="command-list" id="command-results" role="listbox">
        {items.map((command, index) => <button
          id={`command-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'active' : ''}
          key={command.label}
          onPointerEnter={() => setActiveIndex(index)}
          onClick={() => run(command)}
        ><span>{command.label}</span>{command.hint && <kbd>{command.hint}</kbd>}</button>)}
        {!items.length && <div className="hint-empty">No hay comandos coincidentes.</div>}
      </div>
    </div>
  </div>;
}
