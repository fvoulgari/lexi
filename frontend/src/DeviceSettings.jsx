import { languages } from "./copy.js";

export default function DeviceSettings({
  text,
  language,
  setLanguage,
  reducedMotion,
  motion,
  setMotion,
}) {
  return (
    <section
      className="device-settings"
      aria-labelledby="device-settings-title"
    >
      <h2 id="device-settings-title">{text.deviceSettings}</h2>
      <p>{text.deviceSettingsHint}</p>
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
      <label htmlFor="device-motion">{text.motion}</label>
      <select
        id="device-motion"
        value={motion}
        onChange={(event) => setMotion(event.target.value)}
        aria-describedby="motion-hint"
      >
        <option value="system">{text.motionSystem}</option>
        <option value="reduce">{text.motionReduce}</option>
        <option value="full">{text.motionFull}</option>
      </select>
      <p aria-live="polite">
        {reducedMotion ? text.motionReducedActive : text.motionFullActive}
      </p>
      <p id="motion-hint">{text.motionHint}</p>
    </section>
  );
}
