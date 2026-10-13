import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { request } from "./api.js";

export default function Import({ text, csrf, onLocked }) {
  const client = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const reportHeading = useRef(null);
  async function submit(action) {
    setBusy(true);
    setError(null);
    try {
      if (file.size > 1048576) throw new Error(text.csvLimit);
      const report = await request(`/api/imports/${action}`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
        body: file,
      });
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
      setBusy(false);
    }
  }
  const report = result || preview;
  useEffect(() => {
    if (report) reportHeading.current?.focus();
  }, [report]);
  return (
    <section className="csv-import" aria-label={text.csvImport}>
      <h2>{text.csvImport}</h2>
      <p>{text.csvHint}</p>
      <p>
        <a href="/api/imports/example" download>
          {text.csvExample}
        </a>
      </p>
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
      <button
        className="secondary"
        disabled={!file || busy}
        onClick={() => submit("preview")}
      >
        {busy ? text.saving : text.csvPreview}
      </button>
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
          {preview && (
            <>
              <p>{text.csvConfirmHint}</p>
              <h4>{text.csvUnits}</h4>
              <ul>
                {report.proposed_units.map((unit) => (
                  <li key={unit.code}>
                    {unit.code} — {unit.title}
                  </li>
                ))}
              </ul>
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
              disabled={busy || preview.counts.valid === 0}
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
};
