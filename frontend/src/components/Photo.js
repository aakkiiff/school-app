import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { AVATAR_TYPES, deletePhoto, getPhoto, retryPhoto, uploadPhoto, validatePhotoFile } from "../profileApi";

export default function Photo({ kind, recordId, name, initials, color = "", disabled = false, onNotice }) {
  const school = kind === "school";
  const label = school ? "profile photo" : `photo for ${name}`;
  const [photo, setPhoto] = useState({ imageUrl: null, status: "empty" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  const container = useRef(null);
  const trigger = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const timer = useRef(null);
  const badImage = useRef(null);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const next = await getPhoto(kind, recordId);
      if (!mounted.current || generation.current !== version) return;
      setPhoto(next);
      setError("");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => refresh(), next.status === "processing" ? 3000 : 60000);
    } catch (failure) {
      if (!mounted.current || generation.current !== version) return;
      setError(`Photo service unavailable. ${failure.message}`);
      timer.current = setTimeout(() => refresh(), 15000);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [kind, recordId]);

  useEffect(() => {
    mounted.current = true;
    if (recordId) refresh();
    else { setLoading(false); setError("Refresh the directory to load its photo ID."); }
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearTimeout(timer.current);
    };
  }, [refresh, recordId]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !container.current?.contains(event.target)) {
        setOpen(false);
        if (event.type === "keydown") trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const mutate = async (action, file) => {
    setOpen(false);
    setBusy(true);
    generation.current += 1;
    clearTimeout(timer.current);
    try {
      if (action === "remove") {
        await deletePhoto(kind, recordId);
        setPhoto({ imageUrl: null, status: "empty" });
      } else {
        const next = action === "retry" ? await retryPhoto(kind, recordId) : await uploadPhoto(kind, recordId, file);
        setPhoto(next);
      }
      setError("");
      onNotice({ type: "success", text: action === "remove" ? "Photo removed."
        : "Photo submitted. Your thumbnail is processing." });
    } catch (failure) {
      onNotice({ type: "error", text: `Could not ${action} ${label}. ${failure.message}` });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const choose = () => { setOpen(false); input.current?.click(); };
  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validatePhotoFile(file);
    if (invalid) { onNotice({ type: "error", text: invalid }); return; }
    mutate("upload", file);
  };
  const imageError = () => {
    if (badImage.current === photo.imageUrl) {
      setError("The thumbnail could not be displayed. Reconnect to try again.");
      return;
    }
    badImage.current = photo.imageUrl;
    refresh();
  };

  return (
    <div className={`profile-avatar ${school ? "" : "directory-photo"}`} ref={container}>
      <button ref={trigger} type="button"
        className={`${school ? "workspace-avatar" : `record-avatar ${color}`} avatar-button${busy ? " is-saving" : ""}`}
        aria-label={`Edit ${label}`} aria-expanded={open} aria-haspopup="menu"
        disabled={loading || busy || disabled || !recordId} onClick={() => setOpen((value) => !value)}>
        {photo.imageUrl ? <img src={photo.imageUrl} alt={school ? name : `${name} thumbnail`} onError={imageError} /> : <span>{initials}</span>}
        <span className="avatar-badge" aria-hidden="true"><Icon name="camera" /></span>
        {(busy || photo.status === "processing") && <span className="avatar-spinner" aria-hidden="true" />}
      </button>
      {photo.status === "processing" && <span className="photo-status" role="status">Processing</span>}
      {photo.status === "failed" && <span className="photo-status photo-failed">Photo failed</span>}
      {error && <span className="photo-status photo-failed" title={error}>Photo offline</span>}
      <input ref={input} type="file" accept={AVATAR_TYPES.join(",")} className="sr-only"
        tabIndex={-1} aria-label={school ? "Upload profile photo" : `Upload photo for ${name}`} onChange={handleFile} />
      {open && (
        <div className="avatar-menu" role="menu" aria-label={school ? "Profile photo" : `Photo for ${name}`}>
          <p className="avatar-menu-title">{school ? "Profile photo" : "Directory photo"}</p>
          <p className="avatar-menu-hint">{error || photo.error || (photo.status === "processing"
            ? "Thumbnail processing. Your current photo stays until it is ready." : "JPEG, PNG, or WebP up to 5 MB / 20 MP.")}</p>
          {error && <button role="menuitem" onClick={() => { setOpen(false); refresh(); }}><Icon name="refresh" />Reconnect</button>}
          <button role="menuitem" onClick={choose} autoFocus><Icon name="camera" />{photo.imageUrl ? "Change photo" : "Upload photo"}</button>
          {photo.status === "failed" && <button role="menuitem" onClick={() => mutate("retry")}><Icon name="refresh" />Retry thumbnail</button>}
          {(photo.imageUrl || photo.status !== "empty") && <button role="menuitem" className="danger" onClick={() => mutate("remove")}><Icon name="trash" />Remove photo</button>}
        </div>
      )}
    </div>
  );
}
