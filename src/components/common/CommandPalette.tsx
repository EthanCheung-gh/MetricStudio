import { Search } from 'lucide-react';
import { getCommands, type Command } from '@/commands/registry';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';

function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) =>
      c.title.toLowerCase().includes(q) || (c.keywords ?? '').toLowerCase().includes(q),
  );
}

export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const query = useCommandPaletteStore((s) => s.query);
  const activeIndex = useCommandPaletteStore((s) => s.activeIndex);
  const closePalette = useCommandPaletteStore((s) => s.closePalette);
  const setQuery = useCommandPaletteStore((s) => s.setQuery);
  const setActiveIndex = useCommandPaletteStore((s) => s.setActiveIndex);

  // Collect commands on every render while open so dataset/chart lists stay fresh.
  const commands = open ? getCommands() : [];
  const filtered = filterCommands(commands, query);

  if (!open) return null;

  const execute = (cmd: Command) => {
    closePalette();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(Math.min(activeIndex + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) execute(cmd);
    }
  };

  const grouped = new Map<string, Command[]>();
  for (const cmd of filtered) {
    const list = grouped.get(cmd.category) ?? [];
    list.push(cmd);
    grouped.set(cmd.category, list);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={closePalette}
    >
      <div
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search datasets / charts…"
            className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted">
              No matching commands
            </div>
          )}
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {category}
              </div>
              {items.map((cmd) => {
                const idx = filtered.indexOf(cmd);
                const active = idx === activeIndex;
                return (
                  <button
                    key={cmd.id}
                    className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm ${
                      active
                        ? 'bg-primary/20 text-primary'
                        : 'text-foreground hover:bg-surface'
                    }`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => execute(cmd)}
                  >
                    <span className="text-muted">{cmd.icon}</span>
                    <span className="flex-1 truncate">{cmd.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
