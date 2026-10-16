import { languages } from "./copy.js";

export default function DeviceSettings({
  text,
  language,
  setLanguage,
}) {
  return (
    <section
      className="device-settings settings-card"
      aria-labelledby="device-settings-title"
    >
      <h2 id="device-settings-title">{text.deviceSettings}</h2>
      <div className="device-fields">
        <div>
          <label htmlFor="device-language">{text.deviceLanguage}</label>
          <select
            id="device-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {Object.entries(languages).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="settings-helper device-save-hint">{text.deviceSettingsHint}</p>
    </section>
  );
}
