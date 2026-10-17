export async function request(path, options = {}) {
  const { responseType, ...fetchOptions } = options;
  if (!navigator.onLine) {
    throw Object.assign(new Error("Connection unavailable"), { code: "connection_error" });
  }
  let response;
  try {
    response = await fetch(new URL(path, window.location.origin), {
      credentials: "same-origin",
      cache: "no-store",
      ...fetchOptions,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw Object.assign(new Error("Connection unavailable"), {
      code: "connection_error",
    });
  }
  if (response.ok && responseType === "blob") return response.blob();
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message || "Request failed"), {
      code: body.error?.code || "request_failed",
      status: response.status,
      fields: body.error?.fields,
      entry_ids: body.error?.entry_ids,
    });
  }
  return body;
}

export async function downloadLibrary() {
  const blob = await request("/api/vocabulary/export.csv", {
    responseType: "blob",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "italian-notebook.csv";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to consume the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
