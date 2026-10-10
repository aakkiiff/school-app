export const PROFILE_BASE = process.env.REACT_APP_PROFILE_API_URL || "http://localhost:5004";
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validatePhotoFile(file) {
  if (!AVATAR_TYPES.includes(file.type)) return "Choose a JPEG, PNG, or WebP image.";
  if (file.size > MAX_AVATAR_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

async function call(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort);
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(`${PROFILE_BASE}${path}`, { ...options, signal: controller.signal });
    if (response.status === 204 && response.ok) return null;
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`The photo service returned an invalid response (${response.status}).`);
    }
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    if (!body || typeof body !== "object") throw new Error("The photo service returned an unexpected response.");
    return body;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("The photo service took too long to respond.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

const pathFor = (kind, id) => kind === "school" ? "/profile/avatar"
  : `/photos/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;

export const getPhoto = (kind, id, signal) => call(pathFor(kind, id), { signal });
export function uploadPhoto(kind, id, file) {
  const form = new FormData();
  form.append("image", file);
  return call(pathFor(kind, id), { method: "PUT", body: form });
}
export const deletePhoto = (kind, id) => call(pathFor(kind, id), { method: "DELETE" });
export const retryPhoto = (kind, id) => call(`${pathFor(kind, id)}/retry`, { method: "POST" });
export const getAvatar = () => getPhoto("school", "admin");
export const uploadAvatar = (file) => uploadPhoto("school", "admin", file);
export const deleteAvatar = () => deletePhoto("school", "admin");
