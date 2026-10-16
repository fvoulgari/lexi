import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { Info } from "lucide-react";
import { request } from "./api.js";
export default function OrganizationForm({
  kind,
  text,
  csrf,
  onLocked,
  onClose,
  onCreated,
}) {
  const [values, setValues] = useState(
    kind === "units" ? { code: "", title: "" } : { name: "" },
  );
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      request(`/api/${kind}`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify(
          kind === "units" ? { ...values, sort_order: 0 } : values,
        ),
      }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: [kind] });
      onCreated?.(result);
      onClose();
    },
    onError: (error) => {
      if (error.status === 401) onLocked();
    },
  });
  const labels = {
    code: text.unitCode,
    title: text.unitTitle,
    name: text.tagName,
  };
  return (
    <form
      className="vocabulary-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>{kind === "units" ? text.createUnit : text.createTag}</h2>
      {kind === "units" && (
        <p id="unit-creation-hint" className="unit-creation-hint">
          <Info size={16} aria-hidden="true" />
          <span>{text.unitCreationHint}</span>
        </p>
      )}
      <fieldset
        disabled={save.isPending}
        aria-describedby={kind === "units" ? "unit-creation-hint" : undefined}
      >
        <div className="entry-fields">
          {Object.entries(values).map(([key, value], index) => (
            <label key={key}>
              {labels[key]}
              <input
                ref={index === 0 ? first : undefined}
                required
                type="text"
                maxLength={key === "code" ? 20 : key === "title" ? 160 : 80}
                value={value}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }));
                  save.reset();
                }}
              />
            </label>
          ))}
        </div>
        {save.isError && (
          <p role="alert" className="error">
            {text.errors[save.error.code] || text.errors.request_failed}{" "}
            {save.error.fields?.map((field) => labels[field]).join(", ")}
          </p>
        )}
        <div className="form-actions">
          <button className="primary" type="submit">
            {save.isPending ? text.saving : text.create}
          </button>
          <button className="secondary" type="button" onClick={onClose}>
            {text.cancel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
OrganizationForm.propTypes = {
  kind: PropTypes.string.isRequired,
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onLocked: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
};
