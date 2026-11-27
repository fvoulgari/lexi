import { useMemo } from "react";
import LanguagePicker from "./LanguagePicker.jsx";
import {
  languageAliases,
  languageTextProps,
  nativeLanguageName,
  pairLabel,
  parsePairKey,
} from "./languages.js";

/**
 * Searchable selector for unordered language pairs that have eligible cards.
 *
 * It reuses the combobox contract from LanguagePicker, so pair search accepts
 * translated labels, native names, aliases and language codes with the same
 * keyboard and touch behaviour as every other language choice.
 */
export default function PairPicker({
  pairs = [],
  value,
  onChange,
  label,
  emptyMessage,
  errorMessage,
  loadingMessage,
  clearLabel,
  recentHeading,
  popularHeading,
  loading = false,
  error = false,
  empty = false,
  disabled = false,
}) {
  const options = useMemo(() => {
    const rows = pairs.map((pair) => ({
      id: pair.key,
      label: pairLabel(pair.languages),
      native_name: pair.languages.map(nativeLanguageName).join(" / "),
      aliases: pair.languages.flatMap((code) => languageAliases(code)),
      textProps: languageTextProps(pair.languages[0]),
    }));
    // Keep a temporarily unavailable current pair visible instead of clearing
    // a valid preference while access or card counts change.
    const languages = parsePairKey(value);
    if (languages && !rows.some((row) => row.id === value)) {
      rows.unshift({
        id: value,
        label: pairLabel(languages),
        native_name: languages.map(nativeLanguageName).join(" / "),
        aliases: languages.flatMap((code) => languageAliases(code)),
        textProps: languageTextProps(languages[0]),
      });
    }
    return rows;
  }, [pairs, value]);

  return (
    <LanguagePicker
      className="practice-pair-picker"
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      emptyMessage={emptyMessage}
      errorMessage={errorMessage}
      loadingMessage={loadingMessage}
      clearLabel={clearLabel}
      recentHeading={recentHeading}
      popularHeading={popularHeading}
      loading={loading}
      error={error}
      empty={empty}
      disabled={disabled}
      recentKey="practice-pairs"
    />
  );
}
