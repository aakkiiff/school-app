import React, { useState } from "react";
import Icon from "./Icon";
import Photo from "./Photo";

function RecordRow({ record, config, disabled, onEdit, onDelete, onNotice }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(record);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const name = String(record.name || "");
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const save = async (event) => {
    event.preventDefault();
    const updated = {
      ...form,
      name: form.name.trim(),
      [config.detailField]: form[config.detailField].trim(),
    };
    if (!updated.name || !updated[config.detailField]) {
      setError("Please complete every field. Spaces alone are not valid.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      if (await onEdit(updated)) setEditing(false);
    } catch (failure) {
      setError(`Could not update this record. ${failure.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className={`record-row ${editing ? "editing" : ""}`}>
      {editing ? (
        <form className="edit-form" onSubmit={save} aria-label={`Edit ${name}`}>
          <fieldset disabled={disabled || saving}>
            <div className="edit-fields">
              {[["name", "Full name"], [config.idField, config.idLabel], [config.detailField, config.detailLabel]].map(([field, label]) => (
                <label className="field" key={field}>
                  <span>{label}</span>
                  <input name={field} value={form[field] ?? ""} disabled={field === config.idField} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required />
                </label>
              ))}
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="edit-actions">
              <span className="edit-hint">{config.idLabel} cannot be changed.</span>
              <button className="button button-secondary button-small" type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button className="button button-primary button-small" type="submit"><Icon name="check" />{saving ? "Saving..." : "Save changes"}</button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <Photo kind={config.label.toLowerCase()} recordId={record.recordId} name={name} initials={initials || "?"}
            color={config.color} disabled={disabled} onNotice={onNotice} />
          <div className="record-person"><strong>{name}</strong><span>{config.idLabel}: {record[config.idField]}</span></div>
          <div className="record-detail"><span>{config.detailLabel}</span><p>{record[config.detailField]}</p></div>
          <div className="record-actions">
            <button className="icon-button" aria-label={`Edit ${name}`} title="Edit record" disabled={disabled} onClick={() => { setForm(record); setError(""); setEditing(true); }}><Icon name="edit" /></button>
            <button className="icon-button delete-button" aria-label={`Delete ${name}`} title="Delete record" disabled={disabled} onClick={() => onDelete(record[config.idField])}><Icon name="trash" /></button>
          </div>
        </>
      )}
    </li>
  );
}

export default function RecordList({ records, config, loading, unavailable, disabled, onEdit, onDelete, onAdd, onNotice }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("default");
  const search = query.trim().toLowerCase();
  const filtered = records.filter((record) =>
    [record.name, record[config.idField], record[config.detailField]].some((value) => String(value ?? "").toLowerCase().includes(search))
  );
  if (sort !== "default") {
    filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)) * (sort === "asc" ? 1 : -1));
  }

  return (
    <div className="directory-card" aria-busy={loading}>
      <div className="directory-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input type="search" aria-label={`Search ${config.label.toLowerCase()}`} placeholder={`Search ${config.label.toLowerCase()}...`} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="sort-field"><span className="sr-only">Sort records</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="default">Default order</option><option value="asc">Name: A to Z</option><option value="desc">Name: Z to A</option></select></label>
      </div>
      <div className="list-caption"><span>{loading ? "Loading your directory..." : `${filtered.length} ${filtered.length === 1 ? config.singular.toLowerCase() : config.label.toLowerCase()}${search ? ` matching "${query.trim()}"` : " in your directory"}`}</span><span className="list-caption-right">Every person matters</span></div>
      {loading ? (
        <div className="skeleton-list" role="status" aria-label="Loading records">{[0, 1, 2].map((index) => <div className="skeleton-row" key={index}><span /><div><i /><i /></div></div>)}</div>
      ) : filtered.length > 0 ? (
        <ul className="record-list">
          {filtered.map((record) => <RecordRow key={record.recordId || record[config.idField]} record={record} config={config} disabled={disabled} onEdit={onEdit} onDelete={onDelete} onNotice={onNotice} />)}
        </ul>
      ) : (
        <div className="empty-state">
          <span className={`empty-icon ${config.color}`}><Icon name={search ? "search" : unavailable ? "info" : config.icon} /></span>
          <h3>{search ? "No matches just yet" : unavailable ? "Your directory is unavailable" : "A fresh start for your community"}</h3>
          <p>{search ? "Try a different name, ID, or detail to find who you're looking for." : unavailable ? "We couldn't connect to this service. Use Refresh to try again." : `Add your first ${config.singular.toLowerCase()} and watch your school community grow.`}</p>
          {search ? <button className="button button-secondary" onClick={() => setQuery("")}>Clear search</button> : !unavailable && <button className="button button-secondary" onClick={onAdd} disabled={disabled}><Icon name="plus" />Add your first {config.singular.toLowerCase()}</button>}
        </div>
      )}
      <div className="directory-card-footer"><span className="tiny-dot" />{loading ? "Connecting to your school registry" : unavailable ? "Showing last available records" : "Connected to your school registry"}</div>
    </div>
  );
}
