import { useAccount } from "./AccountContext.jsx";
export default function AudiencePicker({
  value,
  onChange,
  text,
  disabled = false,
}) {
  const account = useAccount();
  return (
    <label>
      {text.visibility}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="private">{text.private}</option>
        {account?.role === "admin" && (
          <option value="published">{text.published}</option>
        )}
      </select>
    </label>
  );
}
