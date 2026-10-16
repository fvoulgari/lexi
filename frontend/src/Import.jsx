import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { FileDown, ArrowRight } from "lucide-react";
import UnitPicker from "./UnitPicker.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import csvExample from "../../backend/app/csv_example.json";
import { request } from "./api.js";

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
  const [busy, setBusy] = useState(false);
  const reportHeading = useRef(null);
  async function submit(action) {
    onAttention();
    setBusy(true);
    setError(null);
    try {
      if (file.size > 1048576) throw new Error(text.csvLimit);
      const report = await request(
        `/api/imports/${action}?unit_id=${encodeURIComponent(unitId)}`,
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
          body: file,
        },
      );
      if (action === "preview") {
        setPreview(report);
        setResult(null);
      } else {
        setResult(report);
        setPreview(null);
        for (const key of ["vocabulary", "units", "tags"])
          client.invalidateQueries({ queryKey: [key] });
      }
    } catch (failure) {
      if (failure.status === 401) onLocked();
      else
        setError(
          failure.code === "invalid_csv"
            ? `${text.csvInvalid} ${failure.message}`
            : text.errors[failure.code] || failure.message,
        );
    } finally {
      onAttention();
      setBusy(false);
    }
  }
  const report = result || preview;
  useEffect(() => {
    if (report) reportHeading.current?.focus();
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
        disabled={busy || units.isPending || creatingUnit}
        onCreate={() => setCreatingUnit(true)}
        onChange={(value) => {
          setUnitId(value);
          setPreview(null);
          setResult(null);
          setError(null);
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
            requestAnimationFrame(() => document.getElementById("csv-destination-unit")?.focus());
          }}
          onCreated={(unit) => {
            setUnitId(unit.id);
            setPreview(null);
            setResult(null);
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
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files[0] || null);
            setPreview(null);
            setResult(null);
            setError(null);
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
          className="primary"
          disabled={
            !file ||
            !unitId ||
            busy ||
            units.isError ||
            units.isPending ||
            creatingUnit
          }
          onClick={() => submit("preview")}
        >
          {busy ? text.saving : text.csvPreview}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
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
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {report && (
        <div>
          <h3 ref={reportHeading} tabIndex={-1}>
            {result ? text.csvResult : text.csvPreview}
          </h3>
          <p role={result ? "status" : undefined}>
            {["imported", "valid", "skipped", "duplicate", "error"]
              .map((key) => `${text.csvCounts[key]}: ${report.counts[key]}`)
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
          {preview && (
            <>
              <p>{text.csvConfirmHint}</p>
              <h4>{text.csvTags}</h4>
              <ul>
                {report.proposed_tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            </>
          )}
          <ol className="import-rows">
            {report.rows.map((row) => (
              <li key={row.row}>
                <strong>
                  {text.csvRow} {row.row} · {text.csvCounts[row.status]}
                </strong>
                <p>
                  <span lang="it">{row.italian}</span> —{" "}
                  <span lang="el">{row.greek}</span>
                </p>
                {row.entry && (
                  <details>
                    <summary>{text.csvDetails}</summary>
                    <dl>
                      {Object.entries(row.entry)
                        .filter(([, value]) => value != null && value !== "")
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{text.fields[key] || key}</dt>
                            <dd>
                              {[
                                "word_type",
                                "italian_gender",
                                "greek_gender",
                              ].includes(key)
                                ? text[value]
                                : value}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    {row.unit && (
                      <p>
                        {text.unit}: {row.unit.code} — {row.unit.title}
                      </p>
                    )}
                    {row.tags?.length > 0 && (
                      <p>
                        {text.tags}: {row.tags.join(", ")}
                      </p>
                    )}
                  </details>
                )}
                <ul>
                  {row.errors.map((message, index) => (
                    <li key={index} className="error">
                      {message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {preview && (
            <button
              className="primary"
              disabled={
                busy || !unitId || creatingUnit || preview.counts.valid === 0
              }
              onClick={() => submit("confirm")}
            >
              {busy ? text.saving : text.csvConfirm}
            </button>
          )}
        </div>
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
