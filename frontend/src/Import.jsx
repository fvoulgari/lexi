import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Upload } from "lucide-react";
import { request } from "./api.js";
import { collectionCopy } from "./collection-copy.js";
import CsvDialog from "./CsvDialog.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ImportEntryDetails from "./ImportEntryDetails.jsx";
import { cardLanguageIds, cardText } from "./card-sides.js";
import { configuredLanguages } from "./grammar.js";
import {
  languageLabel,
  languageTextProps,
  LEGACY_PAIR,
  useLanguageRegistry,
} from "./languages.js";

const PAGE_SIZE = 10;

/** Minimal CSV parser used to recognise headers and suggest column mapping. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item !== ""));
}

const MAPPABLE_TARGETS = [
  "csv_format",
  "word_type",
  "notes",
  "tags",
  "unit_code",
  "unit_title",
  "unit_sort_order",
];

function csvHeaders(text) {
  return (parseCsv(text)[0] || []).map((header) => header.trim());
}

function textLanguageIds(headers) {
  return headers
    .filter((header) => header.startsWith("text_"))
    .map((header) => header.slice(5));
}

function needsColumnMapping(headers, languages = []) {
  if (headers.length === 0) return false;
  const names = new Set(headers);
  const textIds = textLanguageIds(headers);
  const known =
    (names.has("base") && names.has("learning")) ||
    (names.has("italian") && names.has("greek")) ||
    ((names.has("card_source_language") ||
      names.has("card_target_language")) &&
      textIds.length >= 2) ||
    (textIds.length === 2 &&
      languages.length > 0 &&
      textIds.every((language) => languages.includes(language)));
  const hasWordType = names.has("word_type") || names.has("type");
  return !known || !hasWordType;
}

function suggestedMapping(headers, source, target, text) {
  const known = new Set(MAPPABLE_TARGETS);
  const mapping = {};
  const [firstRow = []] = parseCsv(text).slice(1);
  const explicit = headers.findIndex((header) => header === "csv_format");
  headers.forEach((header) => {
    const lower = header.toLocaleLowerCase();
    if (known.has(header) || header.startsWith("text_") || header.startsWith("grammar_")) {
      mapping[header] = header;
    } else if (/type|tipo|τύπ/.test(lower)) {
      mapping[header] = "word_type";
    } else if (/note|nota|σημει/.test(lower)) {
      mapping[header] = "notes";
    } else if (/tag|etichett|ετικ/.test(lower)) {
      mapping[header] = "tags";
    } else if (source && !Object.values(mapping).includes(`text_${source}`)) {
      mapping[header] = `text_${source}`;
    } else if (target && !Object.values(mapping).includes(`text_${target}`)) {
      mapping[header] = `text_${target}`;
    } else {
      mapping[header] = "";
    }
  });
  if (explicit >= 0 && firstRow[explicit]) mapping[headers[explicit]] = "csv_format";
  return mapping;
}

function mappingOptions(headers, source, target, languages, text) {
  const options = [
    ["word_type", text.csvMapWordType],
    ["notes", text.csvMapNotes],
    ["tags", text.csvMapTags],
  ];
  const textIds =
    source && target
      ? [source, target]
      : languages.filter((language) => headers.some((header) => header.includes(language)));
  for (const language of textIds) {
    options.push([
      `text_${language}`,
      `${text.csvMapping}: ${languageLabel(language)}`,
    ]);
    if (configuredLanguages().includes(language)) {
      options.push([
        `grammar_${language}`,
        text.csvMapGrammar.replace("{language}", languageLabel(language)),
      ]);
    }
  }
  return options;
}

function isImportDestination(collection, languages = LEGACY_PAIR) {
  if (!collection) return false;
  const pair = [collection.source_language, collection.target_language];
  const supported =
    pair[0] !== pair[1] &&
    pair.length === 2 &&
    pair.every((code) => languages.includes(code));
  if (languages.length === 2 && !supported) return false;
  if (typeof collection.can_import === "boolean") return collection.can_import;
  return collection.can_edit && supported;
}

function isPublicDestination(collection, mode, makePublic) {
  return mode === "new" ? makePublic : collection?.visibility === "published";
}

const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

export default function Import({
  text,
  csrf,
  onLocked = () => {},
  onClose,
  onCreated = () => {},
  onImported,
  initialMode = "existing",
  selectedCollection,
  language,
  languages = LEGACY_PAIR,
}) {
  const t = collectionCopy[language];
  const registry = useLanguageRegistry();
  const catalogue = registry?.ids || languages;
  const destinationFor = (collection) =>
    isImportDestination(collection, languages);
  const [mode, setMode] = useState(initialMode);
  const [collectionId, setCollectionId] = useState(
    destinationFor(selectedCollection) ? selectedCollection.id : "",
  );
  const [name, setName] = useState("");
  const [makePublic, setMakePublic] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  // A new collection needs an explicit orientation; picking the first two
  // catalogue entries would silently invent a pair for the learner.
  const initialBase = selectedCollection?.source_language || "";
  const initialLearning = selectedCollection?.target_language || "";
  const [base, setBase] = useState(initialBase);
  const [learning, setLearning] = useState(initialLearning);
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [previewRequested, setPreviewRequested] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const submitting = useRef(false);
  const newCollectionRequest = useRef(null);
  const fileId = useId();
  const {
    data: collections = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    refetchOnMount: "always",
  });
  const destinations = collections.filter(destinationFor);
  const existingDestination = destinations.find(
    (collection) => collection.id === collectionId,
  );
  const destination =
    mode === "existing" ? !isError && existingDestination?.name : name.trim();
  const orientation =
    mode === "existing" && existingDestination
      ? [existingDestination.source_language, existingDestination.target_language]
      : [base, learning];
  const [sourceLanguage, targetLanguage] = orientation;
  const params = new URLSearchParams({ fixed_destination: "true" });
  if (mode === "existing") params.set("collection_id", collectionId);
  else {
    params.set("new_name", name.trim());
    if (sourceLanguage && targetLanguage) {
      params.set("source_language", sourceLanguage);
      params.set("target_language", targetLanguage);
    }
    if (makePublic) params.set("make_public", "true");
  }
  const exampleParams = new URLSearchParams({ format: "template" });
  if (mode === "existing" && collectionId)
    exampleParams.set("collection_id", collectionId);
  else if (sourceLanguage && targetLanguage) {
    exampleParams.set("source_language", sourceLanguage);
    exampleParams.set("target_language", targetLanguage);
  }
  const exampleHref = `/api/imports/example?${exampleParams}`;
  const mappingNeeded = needsColumnMapping(headers, catalogue);
  const columnOptions = mappingOptions(
    headers,
    sourceLanguage,
    targetLanguage,
    catalogue,
    text,
  );
  const selectedTargets = Object.values(columnMapping).filter(Boolean);
  const mappingValid =
    !mappingNeeded ||
    (selectedTargets.includes("word_type") &&
      new Set(selectedTargets).size === selectedTargets.length);
  const previewParams = new URLSearchParams(params);
  if (mappingNeeded)
    previewParams.set("column_mapping", JSON.stringify(columnMapping));
  const destinationKey = previewParams.toString();
  const canCreate =
    mode === "new" && Boolean(destination && sourceLanguage && targetLanguage);
  const canPreview = Boolean(
    destination && file && headers.length > 0 && mappingValid &&
      (mode === "existing" || (sourceLanguage && targetLanguage)),
  );
  const currentPreview = canPreview && preview?.key === destinationKey;
  const report = currentPreview ? preview.report : null;
  const publicDestination = isPublicDestination(
    mode === "new" ? null : existingDestination,
    mode,
    makePublic,
  );
  const canConfirm =
    currentPreview && Boolean(report?.counts.valid) && (!publicDestination || publicConsent);

  function changeDestination(change, value) {
    setPreview(null);
    setError(null);
    setPublicConsent(false);
    setFilter("all");
    setPage(1);
    change(value);
  }

  const destinationIds = destinations.map((collection) => collection.id).join(",");
  useEffect(() => {
    if (mode !== "existing" || isError || collectionId) return;
    const authorized = isImportDestination(selectedCollection, languages)
      ? selectedCollection.id
      : "";
    if (authorized && destinationIds.split(",").includes(authorized))
      setCollectionId(authorized);
  }, [collectionId, destinationIds, isError, languages, mode, selectedCollection]);

  useEffect(() => {
    if (!file) {
      setHeaders([]);
      setColumnMapping({});
      return undefined;
    }
    let active = true;
    file.text().then((value) => {
      if (!active) return;
      const found = csvHeaders(value);
      setHeaders(found);
      setColumnMapping(
        suggestedMapping(found, sourceLanguage, targetLanguage, value),
      );
    });
    return () => {
      active = false;
    };
  }, [file, sourceLanguage, targetLanguage]);

  useEffect(() => {
    if (!canPreview || !previewRequested) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const report = await request(`/api/imports/preview?${destinationKey}`, {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
          body: file,
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setPreview({ key: destinationKey, report });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 401) onLocked();
        else {
          setError(text.errors[failure.code] || failure.message);
          setPreviewRequested(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    canPreview,
    previewRequested,
    destinationKey,
    file,
    csrf,
    onLocked,
    text,
  ]);

  async function create() {
    if (submitting.current || !canCreate) return;
    submitting.current = true;
    setImporting(true);
    setError(null);
    try {
      const created = await request("/api/collections", {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          source_language: sourceLanguage,
          target_language: targetLanguage,
          make_public: makePublic,
        }),
      });
      onCreated(created);
    } catch (failure) {
      if (failure.status === 401) onLocked();
      else setError(text.errors[failure.code] || failure.message);
    } finally {
      submitting.current = false;
      setImporting(false);
    }
  }

  async function confirm() {
    if (
      submitting.current ||
      !canPreview ||
      !canConfirm
    )
      return;
    submitting.current = true;
    setImporting(true);
    setError(null);
    let result;
    const confirmParams = new URLSearchParams(destinationKey);
    confirmParams.set("expected_valid", report.counts.valid);
    if (publicDestination) {
      confirmParams.set("confirm_public_exposure", "true");
      if (report.preview_token)
        confirmParams.set("preview_token", report.preview_token);
    }
    if (mode === "new") {
      const last = newCollectionRequest.current;
      if (
        last?.destinationKey !== destinationKey ||
        last.file !== file
      ) {
        newCollectionRequest.current = {
          destinationKey,
          file: file,
          id: crypto.randomUUID(),
        };
      }
      confirmParams.set("new_collection_id", newCollectionRequest.current.id);
    }
    try {
      result = await request(`/api/imports/confirm?${confirmParams}`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
        body: file,
      });
    } catch (failure) {
      if (failure.status === 401) onLocked();
      else {
        setError(text.errors[failure.code] || failure.message);
        if (failure.status === 409) {
          setPreview((previous) => ({ ...previous, key: null }));
          setPreviewRequested(false);
        }
      }
    } finally {
      submitting.current = false;
      setImporting(false);
    }
    if (result) onImported(result);
  }

  const rows = report?.rows || [];
  const groups = [
    ["all", text.csvAllRows, rows],
    [
      "valid",
      text.csvValidRows,
      rows.filter((row) => ["valid", "updated"].includes(row.status)),
    ],
    [
      "duplicate",
      text.csvDuplicateRows,
      rows.filter((row) => row.status === "duplicate"),
    ],
    ["error", text.csvErrorRows, rows.filter((row) => row.status === "error")],
  ];
  const filtered = groups.find(([key]) => key === filter)[2];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pages);
  const validating = canPreview && previewRequested && !currentPreview;

  return (
    <CsvDialog
      title={text.toolsImport}
      cancelLabel={text.cancel}
      busy={importing}
      onClose={onClose}
    >
      <fieldset className="csv-fields" disabled={importing}>
        <fieldset className="csv-options">
          <legend>{text.csvDestination}</legend>
          {[
            ["existing", t.existingCollection],
            ["new", t.newCollection],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="radio"
                name="destination-mode"
                checked={mode === key}
                onChange={() => changeDestination(setMode, key)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {mode === "existing" ? (
          <label className="collection-field">
            {t.collection}
            <select
              className="collection-select"
              value={existingDestination?.id || ""}
              disabled={isPending || isError || destinations.length === 0}
              onChange={(event) =>
                changeDestination(setCollectionId, event.target.value)
              }
            >
              <option value="">{t.chooseCollection}</option>
              {destinations.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mode === "existing" && existingDestination && (
          <p className="csv-orientation">
            {t.baseLanguage}: {languageLabel(sourceLanguage)} · {t.learningLanguage}:{" "}
            {languageLabel(targetLanguage)}
          </p>
        )}
        {mode === "new" && (
          <>
            <label className="collection-field">
              {t.name}
              <input
                value={name}
                maxLength={160}
                required
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.trim() === name.trim()) setName(value);
                  else changeDestination(setName, value);
                }}
              />
            </label>
            <p className="csv-orientation">{t.choosePair}</p>
            <div className="csv-language-pair">
              <label className="collection-field">
                {t.baseLanguage}
                <LanguagePicker
                  label={t.baseLanguage}
                  value={base}
                  onChange={(value) => changeDestination(setBase, value)}
                  exclude={[learning]}
                  recentKey="import-base"
                  clearLabel={text.csvClearSearch}
                  emptyMessage={text.errors.request_failed}
                />
              </label>
              <label className="collection-field">
                {t.learningLanguage}
                <LanguagePicker
                  label={t.learningLanguage}
                  value={learning}
                  onChange={(value) => changeDestination(setLearning, value)}
                  exclude={[base]}
                  recentKey="import-learning"
                  clearLabel={text.csvClearSearch}
                  emptyMessage={text.errors.request_failed}
                />
              </label>
            </div>
            <fieldset className="csv-options csv-visibility">
              <legend>{t.visibility}</legend>
              <label>
                <input
                  type="radio"
                  name="csv-visibility"
                  checked={!makePublic}
                  onChange={() => changeDestination(setMakePublic, false)}
                />
                {t.onlyYou}
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-visibility"
                  checked={makePublic}
                  onChange={() => changeDestination(setMakePublic, true)}
                />
                {t.published}
              </label>
            </fieldset>
            <p className="csv-visibility-hint">
              {makePublic ? t.publicVisibilityHint : t.privateVisibilityHint}
            </p>
          </>
        )}
        {mode === "existing" &&
          !isError &&
          (isPending || destinations.length === 0) && (
            <span role="status">
              {isPending ? t.loading : t.noImportCollections}
            </span>
          )}
        {mode === "existing" && isError && (
          <div className="form-actions">
            <span role="alert">{text.errors.request_failed}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => refetch()}
            >
              {text.retry}
            </button>
          </div>
        )}
        <section className="csv-template">
          <h3>{text.csvTemplateTitle}</h3>
          <p>{text.csvTemplateHint}</p>
          <a className="csv-example-link" href={exampleHref} download>
            <FileDown size={16} aria-hidden="true" /> {text.csvExample}
          </a>
          <details>
            <summary>{text.csvFormat}</summary>
            <p>{text.csvTemplateHelp}</p>
          </details>
        </section>
        <div className="csv-file-field">
          <label className="secondary csv-file-button" htmlFor={fileId}>
            <Upload size={16} aria-hidden="true" />
            {t.chooseCsv}
            <input
              id={fileId}
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files[0] || null);
                setPreview(null);
                setPreviewRequested(false);
                setError(null);
                setFilter("all");
                setPage(1);
              }}
            />
          </label>
          {file && <span className="csv-filename">{file.name}</span>}
          <span className="csv-auto-detect">{text.csvAutoDetect}</span>
        </div>
        {mappingNeeded && headers.length > 0 && (
          <fieldset className="csv-mapping-fields">
            <legend>{text.csvMapping}</legend>
            <p>{text.csvMappingIntro}</p>
            {headers.map((header, index) => (
              <label key={`${header}-${index}`} className="csv-mapping-row">
                <span>{header}</span>
                <select
                  aria-label={`${text.csvMapping}: ${header}`}
                  value={columnMapping[header] ?? ""}
                  onChange={(event) =>
                    setColumnMapping((current) => ({
                      ...current,
                      [header]: event.target.value,
                    }))
                  }
                >
                  <option value="">{text.csvIgnoreColumn}</option>
                  {columnOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {!mappingValid && (
              <p role="alert" className="error">
                {text.csvMappingError}
              </p>
            )}
          </fieldset>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {report && (
        <section
          className="csv-import-preview"
          aria-label={text.csvPreviewTitle}
          aria-busy={validating}
        >
          <strong>{destination}</strong>
          {publicDestination && (
            <p className="csv-public-notice">{t.publicationExplanation}</p>
          )}
          <div
            className="csv-filters"
            role="group"
            aria-label={text.csvFilters}
          >
            {groups.map(([key, label, items]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setPage(1);
                }}
              >
                {label} ({items.length})
              </button>
            ))}
          </div>
          <ol className="import-rows">
            {filtered
              .slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
              .map((row) => {
                const [source, target] = cardLanguageIds(row);
                return (
                  <li key={row.row}>
                    <div className="csv-row-meta">
                      {text.csvRow} {row.row} · {text.csvCounts[row.status]}
                    </div>
                    <p className="csv-row-words">
                      <span {...languageTextProps(source)}>
                        {cardText(row, source)}
                      </span>{" "}
                      →{" "}
                      <span {...languageTextProps(target)}>
                        {cardText(row, target)}
                      </span>
                    </p>
                    {row.entry && <ImportEntryDetails row={row} text={text} />}
                    {row.errors?.map((message, index) => (
                      <p key={index} className="error">
                        {message}
                      </p>
                    ))}
                  </li>
                );
              })}
          </ol>
          {pages > 1 && (
            <nav className="pagination" aria-label={text.csvPreviewTitle}>
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setPage(activePage - 1)}
              >
                {text.previous}
              </button>
              <span>{format(text.csvPage, { page: activePage, pages })}</span>
              <button
                type="button"
                disabled={activePage >= pages}
                onClick={() => setPage(activePage + 1)}
              >
                {text.next}
              </button>
            </nav>
          )}
        </section>
      )}
      {publicDestination && currentPreview && (
        <label className="csv-public-consent">
          <input
            type="checkbox"
            checked={publicConsent}
            disabled={importing}
            onChange={(event) => setPublicConsent(event.target.checked)}
          />
          {t.publicImportConsent}
        </label>
      )}
      <div className="form-actions csv-dialog-actions">
        {mode === "new" && !file && (
          <button
            type="button"
            className="primary"
            disabled={!canCreate || importing}
            onClick={create}
          >
            {importing ? text.csvImporting : t.create}
          </button>
        )}
        {currentPreview ? (
          <button
            type="button"
            className="primary"
            disabled={importing || !canConfirm}
            onClick={confirm}
          >
            {importing
              ? text.csvImporting
              : publicDestination
                ? t.importAndPublish
                : format(report.counts.valid === 1 ? t.importOne : t.importMany, {
                    count: report.counts.valid,
                    name: destination,
                  })}
          </button>
        ) : mode === "existing" || file ? (
          <button
            type="button"
            className="primary"
            disabled={!canPreview || validating}
            onClick={() => setPreviewRequested(true)}
          >
            {validating ? text.csvValidating : text.csvPreview}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={importing}
          onClick={onClose}
        >
          {text.cancel}
        </button>
      </div>
    </CsvDialog>
  );
}
