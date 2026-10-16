import PropTypes from "prop-types";

export default function UnitPicker({
  text,
  units,
  value,
  onChange,
  onCreate,
  disabled = false,
  id,
  invalid = false,
}) {
  return (
    <div className="unit-assignment">
      <label htmlFor={id}>{text.unit} *</label>
      <div className="unit-assignment-controls">
        <select
          id={id}
          value={value}
          required
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{text.chooseUnit}</option>
          {units.map((unit) => (
            <option value={unit.id} key={unit.id}>
              {unit.code} · {unit.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={onCreate}
        >
          {text.toolsNewUnit}
        </button>
      </div>
    </div>
  );
}
UnitPicker.propTypes = {
  text: PropTypes.object.isRequired,
  units: PropTypes.array.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  id: PropTypes.string.isRequired,
  invalid: PropTypes.bool,
};
