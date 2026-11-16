"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CornerDownLeft, FileText, MapPin, Search, Sparkles, Zap } from "lucide-react";
import { GROUP_LABEL, roomCommands, searchCommands, type Command, type CommandGroup } from "@/lib/commands";
import { isAdmin } from "@/lib/admin";
import { cn } from "@/lib/utils";

const GROUP_ICON: Record<CommandGroup, typeof Search> = { pages: FileText, actions: Zap, rooms: MapPin, ask: Sparkles };

/**
 * The command palette: type to reach any page, room or quick action, or to
 * hand the text to Faten as a question. A combobox over a listbox, so it is
 * fully usable from the keyboard (↑ ↓ to move, Enter to run, Esc to close).
 *
 * Loaded on first open (see command-palette-host.tsx); the room list is
 * fetched only then too, so the map data never weighs on other pages.
 */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rooms, setRooms] = useState<Command[]>([]);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    import("@/data/mapData")
      .then((m) => alive && setRooms(roomCommands(m.MAP_DATA.filter(m.isSelectableRoom))))
      .catch(() => undefined);
    isAdmin()
      .then((ok) => alive && setAdmin(ok))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const results = useMemo(() => searchCommands(query, { rooms, admin }), [query, rooms, admin]);
  const current = Math.min(active, results.length - 1);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
    setActive(0);
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    if (command.action === "toggle-theme") {
      const dark = !document.documentElement.classList.contains("dark");
      document.documentElement.classList.toggle("dark", dark);
      try {
        localStorage.setItem("uqu-theme", dark ? "dark" : "light");
      } catch {
        // private mode: the choice just won't be remembered
      }
      window.dispatchEvent(new Event("uqu-theme-change"));
    } else if (command.href) {
      router.push(command.href);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((current + 1) % results.length);
    else if (e.key === "ArrowUp") setActive((current - 1 + results.length) % results.length);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(results.length - 1);
    else if (e.key === "Enter") run(results[current]);
    else return;
    e.preventDefault();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[70] bg-black/40 dark:bg-black/60" />
        <DialogPrimitive.Popup
          aria-label="ابحث أو انتقل"
          className="ds-page fixed inset-x-3 top-[10dvh] z-[71] mx-auto flex max-h-[75dvh] max-w-xl flex-col overflow-hidden rounded-dialog border border-line bg-surface-raised text-ink shadow-dialog outline-none"
        >
          <DialogPrimitive.Title className="sr-only">ابحث أو انتقل</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-5 shrink-0 text-ink-muted" aria-hidden />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results.length ? `${listId}-${current}` : undefined}
              aria-autocomplete="list"
              aria-label="ابحث عن صفحة أو قاعة، أو اكتب سؤالك"
              placeholder="ابحث عن صفحة أو قاعة، أو اكتب سؤالك…"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
            />
            <kbd className="hidden rounded-control border border-line px-1.5 py-0.5 text-caption text-ink-muted sm:block" dir="ltr">Esc</kbd>
          </div>

          <ul ref={listRef} id={listId} role="listbox" aria-label="النتائج" className="overflow-y-auto p-2">
            {results.map((command, index) => {
              const Icon = GROUP_ICON[command.group];
              const first = index === 0 || results[index - 1].group !== command.group;
              const selected = index === current;
              return (
                <li key={command.id} role="presentation">
                  {first && (
                    <p role="presentation" className="px-3 pt-3 pb-1 text-caption font-semibold text-ink-muted">
                      {GROUP_LABEL[command.group]}
                    </p>
                  )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    onClick={() => run(command)}
                    onMouseMove={() => setActive(index)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-body",
                      selected ? "bg-info-soft text-info-ink" : "text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                    {command.hint && <span className="shrink-0 text-small opacity-70">{command.hint}</span>}
                    {selected && <CornerDownLeft className="size-4 shrink-0 opacity-70" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
