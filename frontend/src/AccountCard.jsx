import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { request } from "./api.js";

export default function AccountCard({ text, account, logoutAll, onLocked }) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef(null);
  const identity = useQuery({
    queryKey: ["account-credentials"],
    queryFn: () => request("/api/account/credentials"),
    retry: false,
  });
  const details = identity.data;
  return (
    <section
      className="settings-card account-card"
      aria-labelledby="account-card-title"
    >
      <h2 id="account-card-title">{text.account}</h2>
      <div className="account-identity">
        <strong className="account-name">
          {details?.display_name || account?.display_name}
        </strong>
        {identity.isPending ? (
          <p role="status">{text.loading}</p>
        ) : identity.isError ? (
          <div>
            <p className="error" role="alert">
              {text.actionFailed}
            </p>
            <button className="secondary" onClick={() => identity.refetch()}>
              {text.retry}
            </button>
          </div>
        ) : (
          <>
            <span className="account-email">{details.email}</span>
            <span className="account-method">
              {details.sign_in_methods.length === 1 &&
              details.sign_in_methods[0] === "google"
                ? text.accountGoogle
                : details.sign_in_methods
                    .map((method) => text["accountMethod_" + method])
                    .join(" · ")}
            </span>
          </>
        )}
      </div>
      {!editing && (
        <div className="account-actions">
          {details?.can_change_password && !editing && (
            <button
              className="primary"
              ref={trigger}
              onClick={() => setEditing(true)}
            >
              {text.changePassword}
            </button>
          )}
          <button
            className="secondary"
            disabled={logoutAll.isPending}
            onClick={() => logoutAll.mutate()}
          >
            {text.logoutAll}
          </button>
          {account?.role === "admin" && (
            <Link className="secondary" to="/admin">
              {text.admin}
            </Link>
          )}
        </div>
      )}
      {logoutAll.isError && (
        <p className="error" role="alert">
          {text.actionFailed}
        </p>
      )}
      {editing && details?.can_change_password && (
        <PasswordChange
          text={text}
          onCancel={() => {
            setEditing(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
          onLocked={onLocked}
        />
      )}
    </section>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  current = false,
  invalid,
  description,
  disabled,
  focus,
  text,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="account-password-input">
      <label htmlFor={id}>{label}</label>
      <div className="account-password-control">
        <input
          id={id}
          name={id}
          ref={focus}
          type={visible ? "text" : "password"}
          autoComplete={current ? "current-password" : "new-password"}
          required
          maxLength={256}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!invalid}
          aria-describedby={description}
          disabled={disabled}
        />
        <button
          className="account-password-eye"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? text.authHidePassword : text.authShowPassword}: ${label}`}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function PasswordChange({ text, onCancel, onLocked }) {
  const first = useRef(null);
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [fields, setFields] = useState({});
  useEffect(() => {
    first.current?.focus();
  }, []);
  const change = useMutation({
    mutationFn: () =>
      request("/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: values.current,
          new_password: values.next,
          confirmation: values.confirm,
        }),
      }),
    onSuccess: onLocked,
    onError: (error) => {
      if (error.status === 401) onLocked();
    },
  });
  const messages = {
    current_password_incorrect: text.currentPasswordIncorrect,
    password_confirmation_mismatch: text.passwordMismatch,
    password_change_rejected: text.authPasswordPolicy,
    login_throttled: text.passwordChangeThrottled,
  };
  return (
    <form
      className="account-password-form"
      aria-labelledby="password-change-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const invalid = {};
        if (!values.current) invalid.current = "authPasswordRequired";
        if (
          Array.from(values.next).length < 15 ||
          Array.from(values.next).length > 128
        )
          invalid.next = "authPasswordPolicy";
        if (!values.confirm || values.next !== values.confirm)
          invalid.confirm = "passwordMismatch";
        setFields(invalid);
        if (!Object.keys(invalid).length) change.mutate();
      }}
    >
      <h3 id="password-change-title">{text.changePassword}</h3>
      <p className="settings-helper">{text.passwordChangeSignout}</p>
      {[
        ["current", text.currentPassword],
        ["next", text.newPassword],
        ["confirm", text.confirmPassword],
      ].map(([key, label]) => (
        <div key={key}>
          <PasswordInput
            id={"account-password-" + key}
            label={label}
            text={text}
            current={key === "current"}
            value={values[key]}
            onChange={(value) => {
              setValues((old) => ({ ...old, [key]: value }));
              change.reset();
              setFields((old) => ({ ...old, [key]: "" }));
            }}
            invalid={
              fields[key] ||
              (key === "current" &&
                change.error?.code === "current_password_incorrect")
            }
            description={
              fields[key]
                ? "password-error-" + key
                : key === "next"
                  ? "account-password-policy"
                  : undefined
            }
            disabled={change.isPending}
            focus={key === "current" ? first : undefined}
          />
          {fields[key] && (
            <p className="error" id={"password-error-" + key}>
              {text[fields[key]]}
            </p>
          )}
        </div>
      ))}
      <p className="settings-helper" id="account-password-policy">
        {text.authPasswordPolicy}
      </p>
      {change.isError && (
        <p className="error" role="alert">
          {messages[change.error.code] || text.authUnavailable}
        </p>
      )}
      <div className="account-actions">
        <button className="primary" disabled={change.isPending}>
          {change.isPending ? text.authLoading_reset : text.changePassword}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={change.isPending}
          onClick={onCancel}
        >
          {text.cancel}
        </button>
      </div>
    </form>
  );
}
