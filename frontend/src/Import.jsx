import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { FileDown, ArrowRight, X } from "lucide-react";
import UnitPicker from "./UnitPicker.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import csvExample from "../../backend/app/csv_example.json";
import { request } from "./api.js";
import ImportEntryDetails from "./ImportEntryDetails.jsx";

const PAGE_SIZE = 10;
const eligible = (row) => ["valid", "updated"].includes(row.status);
const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

export default function Import({ text, csrf, onLocked, onAttention }) {
  const client = useQueryClient();
  const [exampleOpen, setExampleOpen] = useState(false);
  const exampleId = useId();
  const [unitId, setUnitId] = useState("");
  const [creatingUnit, setCreatingUnit] = useState(false);
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
    retry: false,
  });
  useEffect(() => {
    if (units.error?.status === 401) onLocked();
  }, [units.error, onLocked]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState("idle");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const operation = useRef({ id: 0, stage: "idle", controller: null });
  const fileInput = useRef(null);
  const previewTrigger = useRef(null);
  const entryList = useRef(null);
  const reportHeading = useRef(null);
  const previewId = useId();
  const importing = stage === "importing";
  const busy = stage !== "idle";
  useEffect(
    () => () => {
      operation.current.controller?.abort();
      operation.current.id += 1;
    },
    [],
  );
  function resetReport() {
    if (operation.current.stage === "importing") return;
    operation.current.controller?.abort();
    operation.current = {
      id: operation.current.id + 1,
      stage: "idle",
      controller: null,
    };
    setStage("idle");
    setPreview(null);
    setPreviewOpen(false);
    setResult(null);
    setError(null);
    setFilter("all");
    setPage(1);
  }
  function cancel() {
    if (operation.current.stage === "importing") return;
    resetReport();
    setFile(null);
    setUnitId("");
    setCreatingUnit(false);
    if (fileInput.current) fileInput.current.value = "";
    fileInput.current?.focus();
  }
  function closePreview() {
    if (operation.current.stage === "importing") return;
    setPreviewOpen(false);
    previewTrigger.current?.focus();
  }
  function navigatePage(nextPage) {
    setPage(nextPage);
    requestAnimationFrame(() => {
      entryList.current?.focus({ preventScroll: true });
      entryList.current?.scrollIntoView?.({ block: "start" });
    });
  }
  async function submit(action) {
    // Lock synchronously: React state alone does not guard rapid repeated clicks.
    if (operation.current.stage !== "idle" || !file || !unitId) return;
    if (action === "confirm" && (!preview || !preview.rows.some(eligible)))
      return;
    const controller = action === "preview" ? new AbortController() : null;
    const id = operation.current.id + 1;
    const nextStage = action === "preview" ? "validating" : "importing";
    operation.current = { id, stage: nextStage, controller };
    onAttention();
    setStage(nextStage);
    setError(null);
    if (action === "confirm") setPreviewOpen(false);
    try {
      if (file.size > 1048576) throw new Error(text.csvLimit);
      const report = await request(
        `/api/imports/${action}?unit_id=${encodeURIComponent(unitId)}`,
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
          body: file,
          ...(controller ? { signal: controller.signal } : {}),
        },
      );
      // Confirmation sends the original file, never the filtered/visible rows.
      if (action === "confirm") {
        for (const key of [
          "vocabulary",
          "units",
          "tags",
          "difficult-entries",
          "progress-difficult",
        ])
          client.invalidateQueries({ queryKey: [key] });
      }
      if (operation.current.id !== id) return;
      if (action === "preview") {
        setPreview(report);
        setPreviewOpen(true);
        setFilter("all");
        setPage(1);
        setResult(null);
      } else {
        setResult(report);
        setPreview(null);
        setPreviewOpen(false);
      }
    } catch (failure) {
      if (operation.current.id !== id || controller?.signal.aborted) return;
      if (failure.status === 401) onLocked();
      else
        setError(
          failure.code === "invalid_csv"
            ? `${text.csvInvalid} ${failure.message}`
            : action === "confirm"
              ? `${text.errors[failure.code] || failure.message} ${text.csvConfirmationError}`
              : text.errors[failure.code] || failure.message,
        );
    } finally {
      if (operation.current.id === id) {
        operation.current = { id, stage: "idle", controller: null };
        onAttention();
        setStage("idle");
      }
    }
  }
  const report = result || (previewOpen ? preview : null);
  const filters = [
    { key: "all", label: text.csvAllRows, matches: () => true },
    { key: "valid", label: text.csvValidRows, matches: eligible },
    {
      key: "duplicate",
      label: text.csvDuplicateRows,
      matches: (row) => row.status === "duplicate",
    },
    {
      key: "error",
      label: text.csvErrorRows,
      matches: (row) => row.status === "error",
    },
  ];
  const filtered =
    preview?.rows.filter(filters.find((item) => item.key === filter).matches) ||
    [];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const eligibleCount = preview?.rows.filter(eligible).length || 0;
  useEffect(() => {
    if (!report) return;
    const frame = requestAnimationFrame(() => {
      reportHeading.current?.focus();
      reportHeading.current?.scrollIntoView?.({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [report]);
  return (
    <section className="csv-import" aria-label={text.csvImport}>
      <h2>{text.csvImportHeading}</h2>
      <p className="csv-intro">{text.csvIntro}</p>
      <UnitPicker
        id="csv-destination-unit"
        text={text}
        units={units.data || []}
        value={unitId}
        disabled={importing || units.isPending || creatingUnit}
        onCreate={() => setCreatingUnit(true)}
        onChange={(value) => {
          resetReport();
          setUnitId(value);
        }}
      />
      {creatingUnit && (
        <OrganizationForm
          kind="units"
          text={text}
          csrf={csrf}
          onLocked={onLocked}
          onClose={() => {
            setCreatingUnit(false);
            requestAnimationFrame(() =>
              document.getElementById("csv-destination-unit")?.focus(),
            );
          }}
          onCreated={(unit) => {
            resetReport();
            setUnitId(unit.id);
          }}
        />
      )}
      {units.isError && (
        <div>
          <p role="alert" className="error">
            {text.errors.request_failed}
          </p>
          <button type="button" onClick={() => units.refetch()}>
            {text.retry}
          </button>
        </div>
      )}
      <label>
        {text.csvFile}
        <input
          type="file"
          ref={fileInput}
          accept=".csv,text/csv"
          disabled={importing}
          onChange={(event) => {
            resetReport();
            setFile(event.target.files[0] || null);
          }}
        />
      </label>
      <div className="csv-preview-actions">
        <div className="csv-example-actions">
          <button
            type="button"
            className="csv-example-toggle"
            aria-expanded={exampleOpen}
            aria-controls={exampleId}
            onClick={() => setExampleOpen((open) => !open)}
          >
            {text.csvViewExample}
          </button>
          <a href="/api/imports/example" download>
            <FileDown size={17} aria-hidden="true" />
            {text.csvExample}
          </a>
        </div>
        <button
          type="button"
          ref={previewTrigger}
          className="primary"
          aria-expanded={previewOpen}
          aria-controls={previewId}
          disabled={
            !file ||
            !unitId ||
            busy ||
            units.isError ||
            units.isPending ||
            creatingUnit
          }
          onClick={() => (preview ? setPreviewOpen(true) : submit("preview"))}
        >
          {importing
            ? text.csvImporting
            : busy
              ? text.csvValidating
              : preview
                ? text.csvReopenPreview
                : text.csvPreview}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
      {!previewOpen && !result && (file || busy) && (
        <div className="csv-pending-actions">
          {stage === "validating" && (
            <p aria-live="polite">{text.csvValidating}</p>
          )}
          {importing && (
            <p className="csv-import-progress" aria-live="polite">
              <strong>{text.csvImporting}</strong>
              <br />
              {text.csvImportingHint}
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={cancel}
            disabled={importing}
          >
            {text.csvCancel}
          </button>
        </div>
      )}
      <div id={exampleId} hidden={!exampleOpen} className="csv-example-table">
        <table aria-label={text.csvViewExample}>
          <thead>
            <tr>
              {csvExample.headers.map((header) => (
                <th scope="col" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csvExample.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((value, index) => (
                  <td
                    key={index}
                    lang={index === 0 ? "it" : index === 1 ? "el" : undefined}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="csv-requirements">
        <summary>{text.csvFormat}</summary>
        <p>{text.csvHint}</p>
      </details>
      {error && (
        <p role="alert" className="error csv-result-error">
          {error}
        </p>
      )}
      {report && (
        <section
          className={`csv-report-panel${result ? " csv-result-success" : ""}`}
          id={previewId}
          aria-labelledby={`${previewId}-heading`}
          aria-busy={importing}
        >
          <header className="csv-report-heading">
            <h3 id={`${previewId}-heading`} ref={reportHeading} tabIndex={-1}>
              {result ? text.csvResult : text.csvPreviewTitle}
            </h3>
            {!result && (
              <button
                type="button"
                className="csv-close"
                aria-label={text.csvClosePreview}
                title={text.csvClosePreview}
                disabled={importing}
                onClick={closePreview}
              >
                <X size={22} aria-hidden="true" />
              </button>
            )}
          </header>
          <p className="csv-filename">{file?.name}</p>
          <p role={result ? "status" : undefined}>
            {(result
              ? ["imported", "updated", "skipped", "duplicate", "error"]
              : ["valid", "duplicate", "error"]
            )
              .map(
                (key) => `${text.csvCounts[key]}: ${report.counts[key] ?? 0}`,
              )
              .join(" · ")}
          </p>
          {report.destination_unit && (
            <p className="csv-destination-summary">
              {text.csvDestination}:{" "}
              <strong>
                {report.destination_unit.code} · {report.destination_unit.title}
              </strong>
            </p>
          )}
          {report.unit_conflicts > 0 && (
            <p role="note">{text.csvUnitConflict}</p>
          )}
          {!result && (
            <>
              <p>{text.csvReviewHint}</p>
              <details className="csv-import-rules">
                <summary>{text.csvImportRules}</summary>
                <p>{text.csvConfirmHint}</p>
              </details>
              {report.proposed_tags?.length > 0 && (
                <p>
                  <strong>{text.csvTags}:</strong>{" "}
                  {report.proposed_tags.join(", ")}
                </p>
              )}
            </>
          )}
          {!result && (
            <>
              <div
                className="csv-filters"
                role="group"
                aria-label={text.csvFilters}
              >
                {filters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={filter === item.key}
                    onClick={() => {
                      setFilter(item.key);
                      setPage(1);
                    }}
                  >
                    {item.label} ({preview.rows.filter(item.matches).length})
                  </button>
                ))}
              </div>
              <ol
                ref={entryList}
                tabIndex={-1}
                className="import-rows"
                aria-label={text.csvPreviewTitle}
              >
                {visibleRows.map((row) => (
                  <li key={row.row}>
                    <div className="csv-row-meta">
                      <span>
                        {text.csvRow} {row.row} ·{" "}
                        {row.status === "updated"
                          ? text.csvWillUpdate
                          : text.csvCounts[row.status]}
                      </span>
                      {row.entry?.word_type && (
                        <span>{text[row.entry.word_type]}</span>
                      )}
                    </div>
                    <p className="csv-row-words">
                      <span lang="it">{row.italian}</span> →{" "}
                      <span lang="el">{row.greek}</span>
                    </p>
                    {row.entry && <ImportEntryDetails row={row} text={text} />}
                    {row.changed_fields?.length > 0 && (
                      <p>
                        {text.csvChangedFields}:{" "}
                        {row.changed_fields
                          .map((field) =>
                            field === "unit_id"
                              ? text.unit
                              : field === "tags"
                                ? text.tags
                                : text.fields[field] || field,
                          )
                          .join(", ")}
                      </p>
                    )}
                    {row.errors?.length > 0 && (
                      <div className="csv-row-errors">
                        {row.errors.map((message, index) => (
                          <p key={index} className="error">
                            {message}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {!filtered.length && <p>{text.csvNoRows}</p>}
              <nav className="csv-pagination" aria-label={text.csvPreviewTitle}>
                <p aria-live="polite">
                  {format(text.csvRange, {
                    start: filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0,
                    end: Math.min(page * PAGE_SIZE, filtered.length),
                    total: filtered.length,
                  })}
                </p>
                <div>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => navigatePage(page - 1)}
                  >
                    {text.previous}
                  </button>
                  <span aria-current="page">
                    {format(text.csvPage, { page, pages })}
                  </span>
                  <button
                    type="button"
                    disabled={page === pages}
                    onClick={() => navigatePage(page + 1)}
                  >
                    {text.next}
                  </button>
                </div>
              </nav>
              <div className="csv-action-bar">
                <button
                  type="button"
                  className="secondary"
                  disabled={importing}
                  onClick={cancel}
                >
                  {text.csvCancel}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busy || !unitId || creatingUnit || eligibleCount === 0
                  }
                  onClick={() => submit("confirm")}
                >
                  {format(
                    eligibleCount === 1
                      ? text.csvImportCard
                      : text.csvImportCards,
                    { count: eligibleCount },
                  )}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
Import.propTypes = {
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
  onAttention: PropTypes.func.isRequired,
};
