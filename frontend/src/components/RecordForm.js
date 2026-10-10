import React, { useRef, useState } from "react";
import Icon from "./Icon";
import { AVATAR_TYPES, validatePhotoFile } from "../profileApi";

export default function RecordForm({ config, onAdd, disabled, headingRef }) {
  const emptyForm = { name: "", [config.idField]: "", [config.detailField]: "" };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState(null);
  const photoInput = useRef(null);
  const fields = [
    ["name", "Full name", config.namePlaceholder],
    [config.idField, config.idLabel, config.idPlaceholder],
    [config.detailField, config.detailLabel, config.detailPlaceholder],
  ];

  const submit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
    if (Object.values(values).some((value) => !value)) {
      setError("Please complete every field. Spaces alone are not valid.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      if (await onAdd(values, photo)) {
        setForm(emptyForm);
        setPhoto(null);
        if (photoInput.current) photoInput.current.value = "";
      }
    } catch (failure) {
      setError(`Could not save this record. ${failure.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="form-card">
      <div className="form-card-heading">
        <span className={`form-icon ${config.color}`}><Icon name="plus" /></span>
        <h3 ref={headingRef} tabIndex="-1">Add {config.singular.toLowerCase()}</h3>
        <p>{config.formDescription}</p>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={disabled || saving}>
          {fields.map(([field, label, placeholder]) => (
            <label className="field" key={field} htmlFor={`add-${field}`}>
              <span>{label} <span className="required-mark">*</span></span>
              <input id={`add-${field}`} name={field} value={form[field]} placeholder={placeholder} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required />
            </label>
          ))}
          <label className="field">
            <span>Photo <span className="optional-mark">(optional)</span></span>
            <input ref={photoInput} type="file" accept={AVATAR_TYPES.join(",")} aria-label={`Photo for new ${config.singular.toLowerCase()}`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                const invalid = file ? validatePhotoFile(file) : null;
                setError(invalid || "");
                setPhoto(invalid ? null : file || null);
                if (invalid) event.target.value = "";
              }} />
            <small>JPEG, PNG, or WebP. Up to 5 MB / 20 MP.</small>
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="button button-primary full-width" type="submit">
            <Icon name={saving ? "refresh" : "plus"} className={saving ? "spinning" : ""} />
            {saving ? "Saving..." : `Add ${config.singular.toLowerCase()}`}
          </button>
        </fieldset>
      </form>
      <div className="form-footnote"><Icon name="info" /><span>{disabled && !saving ? "Changes are available when the service is connected and no save is in progress." : "Photos are optional and processed in the background. You can change them anytime."}</span></div>
    </aside>
  );
}
