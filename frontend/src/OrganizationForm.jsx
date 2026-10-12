import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import PropTypes from "prop-types";
import { request } from "./api.js";
export default function OrganizationForm({
  kind,
  text,
  csrf,
  onLocked,
  onClose,
}) {
  const [values, setValues] = useState(
    kind === "units" ? { code: "", title: "", sort_order: "0" } : { name: "" },
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
          kind === "units"
            ? { ...values, sort_order: Number(values.sort_order) }
            : values,
        ),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: [kind] });
      onClose();
    },
    onError: (error) => {
      if (error.status === 401) onLocked();
    },
  });
  const labels = {
    code: text.unitCode,
    title: text.unitTitle,
    sort_order: text.sortOrder,
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
      <fieldset disabled={save.isPending}>
        <div className="entry-fields">
          {Object.entries(values).map(([key, value], index) => (
            <label key={key}>
              {labels[key]}
              <input
                ref={index === 0 ? first : undefined}
                required
                type={key === "sort_order" ? "number" : "text"}
                step={key === "sort_order" ? "1" : undefined}
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
};
