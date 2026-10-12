import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    setSelected(result.id);
    setCreating(false);
  }

  return (
    <section className="profiles-page">
      <div className="page-heading">
        <div>
          <h1>{text.settings}</h1>
          <p>{text.profileIntro}</p>
        </div>
      </div>
      <p className="privacy-note">{text.profilePrivacy}</p>
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
            <button className="primary" onClick={() => setCreating(true)}>
              {text.newProfile}
            </button>
          </div>
          {missing && <p>{text.missingProfile}</p>}
          {(creating || profile) && (
            <ProfileForm
              key={creating ? "new" : profile.id}
              profile={creating ? null : profile}
              text={text}
              csrf={csrf}
              onSaved={saved}
              onLocked={onLocked}
            />
          )}
        </>
      )}
    </section>
  );
}

function ProfileForm({ profile, text, csrf, onSaved, onLocked }) {
  const [name, setName] = useState(profile?.display_name || "");
  const [direction, setDirection] = useState(
    profile?.preferred_direction || "greek_to_italian",
  );
  const [size, setSize] = useState(profile?.default_session_size ?? 25);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      request(profile ? `/api/profiles/${profile.id}` : "/api/profiles", {
        method: profile ? "PATCH" : "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          display_name: name.trim(),
          preferred_direction: direction,
          default_session_size: Number(size),
        }),
      }),
    onSuccess: (result) => {
      setSaved(true);
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
        setSaved(false);
        if (!name.trim()) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        save.mutate();
      }}
    >
      <h2>{profile ? text.editProfile : text.newProfile}</h2>
      <fieldset disabled={save.isPending}>
        <label htmlFor="profile-name">{text.displayName}</label>
        <input
          id="profile-name"
          value={name}
          required
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? "profile-validation" : undefined}
        />
        <label htmlFor="profile-direction">{text.direction}</label>
        <select
          id="profile-direction"
          value={direction}
          onChange={(event) => {
            setDirection(event.target.value);
            setSaved(false);
          }}
        >
          <option value="greek_to_italian">
            {text.greek} → {text.italian}
          </option>
          <option value="italian_to_greek">
            {text.italian} → {text.greek}
          </option>
        </select>
        <label htmlFor="profile-size">{text.sessionSize}</label>
        <input
          id="profile-size"
          type="number"
          min={1}
          max={100}
          step={1}
          required
          value={size}
          onChange={(event) => {
            setSize(event.target.value);
            setSaved(false);
          }}
        />
        <p>{text.sizeHint}</p>
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
        <button className="primary" type="submit">
          {save.isPending
            ? text.saving
            : profile
              ? text.savePreferences
              : text.createProfile}
        </button>
      </fieldset>
      {(saved || (!profile && save.isSuccess)) && (
        <p role="status">{text.preferencesSaved}</p>
      )}
    </form>
  );
}
