import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  languageOptions,
  languageTextProps,
  nativeLanguageName,
  POPULAR_LANGUAGE_IDS,
  searchKey,
  useLanguageRegistry,
} from "./languages.js";

const RECENT_LIMIT = 4;

function recentLanguages(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Searchable combobox shared by every language choice.
 *
 * Options come from the curated `/api/languages` registry. Query matching is
 * accent-tolerant and includes native names and aliases; with an empty query
 * the recently used and popular languages are offered before the full
 * catalogue. Every interaction is keyboard accessible and touch-friendly.
 */
export default function LanguagePicker({
  value,
  onChange,
  label,
  options,
  exclude = [],
  disabled = false,
  emptyMessage = "No languages found",
  errorMessage = "Languages could not be loaded. Try again.",
  error = false,
  className = "",
  id,
  recentKey = "default",
}) {
  const registry = useLanguageRegistry();
  const generatedId = useId();
  const inputId = id || `language-picker-${generatedId}`;
  const listId = `${inputId}-list`;
  const storageKey = `lexi-recent-languages-${recentKey}`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [recentIds, setRecentIds] = useState(() => recentLanguages(storageKey));

  const items = useMemo(
    () => options ?? (registry ? languageOptions() : []),
    [options, registry],
  );
  const loading = options === undefined && !registry;
  const selected = useMemo(
    () => items.find((item) => item.id === value),
    [items, value],
  );
  const choices = useMemo(() => {
    const excluded = new Set(exclude);
    const needle = searchKey(query.trim());
    if (needle) {
      return items.filter((item) => {
        if (excluded.has(item.id)) return false;
        return [
          item.label,
          item.native_name,
          ...(item.aliases || []),
          item.id,
        ].some((value) => searchKey(value).includes(needle));
      });
    }
    const byId = new Map(items.map((item) => [item.id, item]));
    const resolve = (ids) =>
      ids.map((languageId) => byId.get(languageId)).filter(Boolean);
    const popular = POPULAR_LANGUAGE_IDS.filter(
      (languageId) => !recentIds.includes(languageId),
    );
    return unique([...resolve(recentIds), ...resolve(popular), ...items]).filter(
      (item) => !excluded.has(item.id),
    );
  }, [exclude, items, query, recentIds]);

  useEffect(() => {
    if (active >= choices.length) setActive(choices.length ? 0 : -1);
  }, [active, choices.length]);

  function close() {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }

  function select(item) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify([item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, RECENT_LIMIT)),
      );
    } catch {
      // Storage may be unavailable in private mode; the choice still applies.
    }
    setRecentIds((current) =>
      [item.id, ...current.filter((id) => id !== item.id)].slice(0, RECENT_LIMIT),
    );
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

  const showRecent = !query.trim() && recentIds.length > 0;
  const recentCount = showRecent
    ? choices.filter((item) => recentIds.includes(item.id)).length
    : 0;

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
        {error ? (
          <li className="language-picker-empty" role="alert">
            {errorMessage}
          </li>
        ) : choices.length === 0 ? (
          <li role="presentation" className="language-picker-empty">
            {loading ? "Loading languages…" : emptyMessage}
          </li>
        ) : (
          choices.map((item, index) => (
            <Fragment key={item.id}>
              {index === 0 && showRecent && (
                <li role="presentation" className="language-picker-heading">
                  Recent
                </li>
              )}
              {index === recentCount && (
                <li role="presentation" className="language-picker-heading">
                  Popular
                </li>
              )}
              <li
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={item.id === value}
                className={`language-picker-option ${index === active ? "is-active" : ""}`}
                onMouseDown={(event) => {
                  // Keep focus on the combobox and stop the wrapping label from
                  // forwarding the option click back to the input.
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  select(item);
                }}
              >
                <span {...languageTextProps(item.id)}>{item.label}</span>
                <span className="language-picker-native">
                  {nativeLanguageName(item.id)}
                </span>
                <span aria-hidden="true" className="language-picker-code">
                  {item.id}
                </span>
                <span aria-hidden="true" className="language-picker-check">
                  {item.id === value ? "✓" : ""}
                </span>
              </li>
            </Fragment>
          ))
        )}
      </ul>
    </div>
  );
}
