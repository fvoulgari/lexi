import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Choices from "./Choices.jsx";
import { request } from "./api.js";

function rememberedProfile() {
  try {
    return localStorage.getItem("notebook-profile") || "";
  } catch {
    return "";
  }
}

export default function Profiles({ text, csrf, onLocked }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(rememberedProfile);
  const [creating, setCreating] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => request("/api/profiles"),
    retry: false,
  });
  const profile = profiles.data?.find((item) => item.id === selected);
  const missing = Boolean(selected && profiles.isSuccess && !profile);
  useEffect(() => {
    if (profiles.error?.status === 401) onLocked();
  }, [profiles.error, onLocked]);
  useEffect(() => {
    if (!profiles.isSuccess) return;
    try {
      if (profile) localStorage.setItem("notebook-profile", profile.id);
      else localStorage.removeItem("notebook-profile");
    } catch {
      /* Selection also works without device storage. */
    }
  }, [profiles.isSuccess, profile]);

  function saved(result) {
    client.setQueryData(["profiles"], (current) => {
      const list = current || [];
      return list.some((item) => item.id === result.id)
        ? list.map((item) => (item.id === result.id ? result : item))
        : [...list, result];
    });
    for (const key of ["progress", "difficult-entries", "progress-difficult"])
      client.invalidateQueries({ queryKey: [key] });
    setSavedId(result.id);
    setSelected(result.id);
    setCreating(false);
  }

  return (
    <section
      className="profiles-page settings-card"
      aria-labelledby="profile-settings-title"
    >
      <h2 id="profile-settings-title">{text.settingsProfileTitle}</h2>
      {profiles.isPending ? (
        <p role="status">{text.loading}</p>
      ) : profiles.isError ? (
        <div>
          <p className="error" role="alert">
            {text.errors[profiles.error.code] || text.errors.request_failed}
          </p>
          <button className="primary" onClick={() => profiles.refetch()}>
            {text.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="profile-controls">
            <label>
              {text.profile}
              <select
                value={profile?.id || ""}
                onChange={(event) => {
                  setSavedId(null);
                  setSelected(event.target.value);
                  setCreating(false);
                }}
              >
                <option value="">{text.chooseProfile}</option>
                {profiles.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              onClick={() => {
                setSavedId(null);
                setCreating(true);
              }}
            >
              {text.settingsNewProfile}
            </button>
          </div>
          <p className="settings-helper profile-sharing">
            {text.settingsPrivacy}
          </p>
          {missing && <p>{text.missingProfile}</p>}
          {(creating || profile) && (
            <ProfileForm
              key={creating ? "new" : profile.id}
              profile={creating ? null : profile}
              text={text}
              csrf={csrf}
              onSaved={saved}
              onChanged={() => setSavedId(null)}
              onLocked={onLocked}
            />
          )}
          {savedId === profile?.id && (
            <p role="status">{text.preferencesSaved}</p>
          )}
        </>
      )}
    </section>
  );
}

function ProfileForm({ profile, text, csrf, onSaved, onChanged, onLocked }) {
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
    retry: false,
  });
  const [practiceUnits, setPracticeUnits] = useState(
    profile?.practice_unit_ids || [],
  );
  useEffect(() => {
    if (units.error?.status === 401) onLocked();
  }, [units.error, onLocked]);

  const [name, setName] = useState(profile?.display_name || "");
  const [direction, setDirection] = useState(
    profile?.preferred_direction || "greek_to_italian",
  );
  const [size, setSize] = useState(
    profile ? (profile.default_session_size ?? "all") : 25,
  );
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      request(profile ? `/api/profiles/${profile.id}` : "/api/profiles", {
        method: profile ? "PATCH" : "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          practice_unit_ids: practiceUnits,
          display_name: name.trim(),
          preferred_direction: direction,
          default_session_size: size === "all" ? null : Number(size),
        }),
      }),
    onSuccess: (result) => {
      onSaved(result);
    },
    onError: (error) => {
      if (error.status === 401) onLocked();
    },
  });
  return (
    <form
      className="profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        onChanged();
        if (!name.trim()) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        save.mutate();
      }}
    >
      {!profile && <h3>{text.settingsNewProfile}</h3>}
      <fieldset disabled={save.isPending}>
        <div className="profile-fields">
          <label className="profile-name-field" htmlFor="profile-name">
            {text.settingsName}
            <input
              id="profile-name"
              value={name}
              required
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                onChanged();
              }}
              aria-invalid={invalid}
              aria-describedby={invalid ? "profile-validation" : undefined}
            />
          </label>
          <label htmlFor="profile-direction">
            {text.settingsDirection}
            <select
              id="profile-direction"
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value);
                onChanged();
              }}
            >
              <option value="greek_to_italian">
                {text.greek} → {text.italian}
              </option>
              <option value="italian_to_greek">
                {text.italian} → {text.greek}
              </option>
            </select>
          </label>
          <label htmlFor="profile-size">
            {text.settingsSessionSize}
            <select
              id="profile-size"
              value={size}
              onChange={(event) => {
                setSize(event.target.value);
                onChanged();
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="all">{text.allEntries}</option>
            </select>
          </label>
        </div>
        <p className="settings-helper">{text.settingsSyncedHint}</p>
        <section
          className="practice-unit-preferences"
          id="practice-units"
          aria-labelledby="practice-unit-title"
        >
          <h3 id="practice-unit-title">{text.practiceUnitsTitle}</h3>
          <p className="settings-helper">{text.practiceUnitsHint}</p>
          {units.isPending && <p role="status">{text.loading}</p>}
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
          {units.isSuccess && (
            <>
              <Choices
                legend={text.units}
                options={units.data.map((unit) => ({
                  id: unit.id,
                  label: `${unit.code} · ${unit.title} — ${(unit.card_count === 1 ? text.unitCardCountOne : text.unitCardCount).replace("{count}", unit.card_count)}`,
                }))}
                selected={practiceUnits}
                onChange={(ids) => {
                  setPracticeUnits(ids);
                  onChanged();
                }}
                disabled={save.isPending}
              />
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPracticeUnits(units.data.map((unit) => unit.id));
                    onChanged();
                  }}
                >
                  {text.selectAllUnits}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPracticeUnits([]);
                    onChanged();
                  }}
                >
                  {text.setupClearFilters}
                </button>
              </div>
              {!practiceUnits.length && (
                <p className="settings-helper">{text.noPracticeUnits}</p>
              )}
            </>
          )}
        </section>
        {invalid && (
          <p id="profile-validation" className="error" role="alert">
            {text.nameRequired}
          </p>
        )}
        {save.isError && (
          <p className="error" role="alert">
            {text.errors[save.error.code] || text.errors.request_failed}
          </p>
        )}
        <button
          className="primary"
          type="submit"
          disabled={units.isPending || units.isError}
        >
          {save.isPending
            ? text.saving
            : profile
              ? text.settingsSave
              : text.createProfile}
        </button>
      </fieldset>
    </form>
  );
}
