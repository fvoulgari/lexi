export async function request(path, options = {}) {
  if (!navigator.onLine) {
    throw Object.assign(new Error("Connection unavailable"), { code: "connection_error" });
  }
  let response;
  try {
    response = await fetch(new URL(path, window.location.origin), {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw Object.assign(new Error("Connection unavailable"), {
      code: "connection_error",
    });
  }
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message || "Request failed"), {
      code: body.error?.code || "request_failed",
      status: response.status,
      fields: body.error?.fields,
    });
  }
  return body;
}
