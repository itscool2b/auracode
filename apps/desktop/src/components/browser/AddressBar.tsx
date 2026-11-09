import { Globe, Lock, Search, TriangleAlert } from "lucide-react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { HistoryEntry } from "../../bindings";
import {
  type BrowserStore,
  knownTld,
  secureAddress,
  shownAddress,
  siteOf,
} from "../../lib/browser";
import { OVER_BROWSER } from "../../lib/browserOcclusion";

/** Whether typed words are an address (Enter opens it) or a search, as the browser will read them. */
export function looksLikeAddress(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(about|file):/i.test(value)) return true;
  if (/^[a-z]:[\\/]/i.test(value)) return true;
  const host = value.split(/[/?#]/)[0] ?? "";
  if (/^(localhost|\[[0-9a-f:]+\])(:\d+)?$/i.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  if (/^[a-z0-9-]+:\d+$/i.test(host)) return true;
  // A real domain ends in a country's two letters or a known generic name, so file.txt and v1.2
  // stay searches, as the browser reads them.
  const domain = host.match(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z0-9-]{2,})(?::\d+)?$/i);
  return domain !== null && knownTld(domain[1] ?? "");
}

export interface AddressBarHandle {
  focus(): void;
}

/**
 * The address bar: the page's address while browsing, what is typed while editing, with pages
 * from history to choose from. Enter opens what is chosen; Esc puts the address back and returns
 * to the page.
 */
export const AddressBar = forwardRef<
  AddressBarHandle,
  {
    readonly url: string | null;
    readonly loading: boolean;
    readonly store: BrowserStore;
    readonly onOpen: (input: string) => void;
    readonly onLeave: () => void;
    readonly autoFocus?: boolean;
    readonly placeholder?: string;
  }
>(function AddressBar(
  { url, loading, store, onOpen, onLeave, autoFocus = false, placeholder },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<readonly HistoryEntry[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useImperativeHandle(ref, () => ({
    focus: () => {
      input.current?.focus();
      input.current?.select();
    },
  }));

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // Pages from history for what is typed, a moment after typing stops.
  useEffect(() => {
    if (!editing || !open) return;
    const typed = text.trim();
    if (!typed) {
      setItems([]);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      store.api.suggest(typed).then(
        (found) => {
          if (current) setItems(found);
        },
        () => {
          if (current) setItems([]);
        },
      );
    }, 70);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [editing, open, text, store]);

  const typed = text.trim();
  const rows: readonly {
    key: string;
    label: string;
    detail: string;
    value: string;
    search: boolean;
  }[] = typed
    ? [
        {
          key: "typed",
          label: looksLikeAddress(typed) ? typed : `Search Google for “${typed}”`,
          detail: looksLikeAddress(typed) ? "Open this address" : "",
          value: typed,
          search: !looksLikeAddress(typed),
        },
        ...items
          .filter((item) => item.url !== typed)
          .map((item) => ({
            key: item.url,
            label: item.title || siteOf(item.url),
            detail: shownAddress(item.url),
            value: item.url,
            search: false,
          })),
      ]
    : [];
  const listOpen = editing && open && rows.length > 0;

  const submit = (value: string) => {
    const target = value.trim();
    if (!target) return;
    setOpen(false);
    setEditing(false);
    input.current?.blur();
    onOpen(target);
  };

  const secure = secureAddress(url);
  return (
    <div className="browser-address" data-editing={editing ? "" : undefined}>
      <span className="browser-address-mark" aria-hidden="true">
        {editing ? (
          <Search size={14} />
        ) : !url ? (
          <Globe size={14} />
        ) : secure ? (
          <Lock size={13} />
        ) : (
          <TriangleAlert size={14} />
        )}
      </span>
      {!editing && url && !secure ? <span className="sr-only">Not secure:</span> : null}
      <input
        ref={input}
        className="browser-address-input"
        type="text"
        role="combobox"
        aria-label="Address and search"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && chosen >= 0 ? `${listId}-${chosen}` : undefined}
        aria-busy={loading || undefined}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder ?? "Search or enter an address"}
        value={editing ? text : shownAddress(url)}
        title={url ?? undefined}
        onFocus={(event) => {
          setEditing(true);
          setText(url ?? "");
          setChosen(-1);
          setOpen(false);
          const field = event.currentTarget;
          requestAnimationFrame(() => field.select());
        }}
        onBlur={() => {
          setEditing(false);
          setOpen(false);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setChosen(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && rows.length) {
            event.preventDefault();
            setOpen(true);
            setChosen((index) => (index + 1) % rows.length);
          } else if (event.key === "ArrowUp" && rows.length) {
            event.preventDefault();
            setChosen((index) => (index <= 0 ? rows.length - 1 : index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const row = listOpen && chosen >= 0 ? rows[chosen] : null;
            submit(row ? row.value : text);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (listOpen) setOpen(false);
            else {
              setText(url ?? "");
              input.current?.blur();
              onLeave();
            }
          }
        }}
      />
      {listOpen ? (
        <div
          id={listId}
          className="browser-suggestions"
          role="listbox"
          aria-label="Suggestions"
          {...{ [OVER_BROWSER]: "" }}
        >
          {rows.map((row, index) => (
            // The field keeps the keyboard (aria-activedescendant); a click picks an option.
            // biome-ignore lint/a11y/useKeyWithClickEvents: arrows and Enter in the field choose
            <div
              key={row.key}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === chosen}
              className="browser-suggestion"
              onMouseDown={(event) => {
                // Keep the field's focus until the choice is made.
                event.preventDefault();
              }}
              onClick={() => submit(row.value)}
              onMouseMove={() => setChosen(index)}
            >
              <span className="browser-suggestion-mark" aria-hidden="true">
                {row.search ? <Search size={14} /> : <Globe size={14} />}
              </span>
              <span className="browser-suggestion-label">{row.label}</span>
              {row.detail ? <span className="browser-suggestion-detail">{row.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
