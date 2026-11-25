import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  languageOptions,
  languageTextProps,
  useLanguageRegistry,
} from "./languages.js";

/** Filter a curated catalogue by the API's display label or language code. */
function matching(options, query, exclude) {
  const needle = query.trim().toLowerCase();
  const excluded = new Set(exclude);
  return options.filter(
    (item) =>
      !excluded.has(item.id) &&
      (!needle ||
        item.label.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle)),
  );
}

/**
 * Reusable, searchable combobox for learning-language choices.
 *
 * Every option and label comes from `/api/languages` through
 * `languageOptions()`, so uncurated or untested languages can never be
 * offered. Keyboard, ARIA and empty-state behaviour is shared by every form
 * that chooses a learning language; interface-language settings stay separate.
 */
export default function LanguagePicker({
  value,
  onChange,
  label,
  options,
  exclude = [],
  disabled = false,
  emptyMessage = "No languages found",
  className = "",
  id,
}) {
  const registry = useLanguageRegistry();
  const generatedId = useId();
  const inputId = id || `language-picker-${generatedId}`;
  const listId = `${inputId}-list`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const items = useMemo(
    () => options ?? (registry ? languageOptions() : []),
    [options, registry],
  );
  const choices = useMemo(
    () => matching(items, query, exclude),
    [items, query, exclude],
  );
  const selected = useMemo(
    () => items.find((item) => item.id === value),
    [items, value],
  );

  useEffect(() => {
    if (active >= choices.length) setActive(choices.length ? 0 : -1);
  }, [active, choices.length]);

  function close() {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }

  function select(item) {
    onChange(item.id);
    close();
    inputRef.current?.focus();
  }

  function onKeyDown(event) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(choices.length ? 0 : -1);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        if (!choices.length) return -1;
        const next = current + step;
        if (next < 0) return choices.length - 1;
        if (next >= choices.length) return 0;
        return next;
      });
    } else if (event.key === "Enter") {
      if (open && active >= 0 && choices[active]) {
        event.preventDefault();
        select(choices[active]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
    } else if (event.key === "Tab") {
      close();
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActive(choices.length ? 0 : -1);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActive(choices.length - 1);
    }
  }

  return (
    <div ref={rootRef} className={`language-combobox ${className}`.trim()}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 && choices[active]
            ? `${listId}-${choices[active].id}`
            : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected?.label ?? label}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(-1);
        }}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setQuery("");
            setActive(-1);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) close();
        }}
      />
      <ul
        hidden={!open}
        id={listId}
        role="listbox"
        aria-labelledby={inputId}
        className="language-combobox-list"
      >
        {choices.length === 0 ? (
          <li role="presentation" className="language-picker-empty">
            {emptyMessage}
          </li>
        ) : (
          choices.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={item.id === value}
              className={index === active ? "is-active" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(item)}
            >
              <span {...languageTextProps(item.id)}>{item.label}</span>
              <span aria-hidden="true" className="language-picker-code">
                {item.id}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
