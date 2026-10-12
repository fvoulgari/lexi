import PropTypes from "prop-types";
export default function Choices({
  legend,
  options,
  selected,
  onChange,
  disabled = false,
}) {
  return (
    <fieldset className="choice-group" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="choice-list">
        {options.map(({ id, label }) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={() =>
                onChange(
                  selected.includes(id)
                    ? selected.filter((value) => value !== id)
                    : [...selected, id],
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
Choices.propTypes = {
  legend: PropTypes.string.isRequired,
  options: PropTypes.array.isRequired,
  selected: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
