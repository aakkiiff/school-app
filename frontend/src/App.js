import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./components/Icon";
import ProfileAvatar from "./components/ProfileAvatar";
import RecordForm from "./components/RecordForm";
import RecordList from "./components/RecordList";
import { registries } from "./registry";
import { uploadPhoto } from "./profileApi";
import "./App.css";

const initialRecords = { students: [], teachers: [], employees: [] };
const initialStatus = { students: "checking", teachers: "checking", employees: "checking" };

async function request(url, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort);
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}). Please try again.`);
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("The service took too long to respond. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function App() {
  const [activeTab, setActiveTab] = useState("students");
  const [records, setRecords] = useState(initialRecords);
  const [status, setStatus] = useState(initialStatus);
  const [errors, setErrors] = useState({});
  const [refreshing, setRefreshing] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestVersions = useRef({});
  const formHeading = useRef(null);
  const config = registries[activeTab];
  const onlineCount = Object.values(status).filter((value) => value === "online").length;
  const checking = Object.values(status).includes("checking");

  const loadRecords = useCallback(async (key, signal) => {
    const version = (requestVersions.current[key] || 0) + 1;
    requestVersions.current[key] = version;
    setRefreshing((previous) => ({ ...previous, [key]: true }));
    try {
      const response = await request(`${registries[key].base}/${key}`, { signal });
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("The service did not return valid JSON. Check the API connection.");
        }
        throw error;
      }
      // The Go service returns null rather than [] for an empty collection.
      if (data !== null && !Array.isArray(data)) {
        throw new Error("The service returned an unexpected response.");
      }
      if (signal?.aborted || requestVersions.current[key] !== version) return false;
      setRecords((previous) => ({ ...previous, [key]: data || [] }));
      setStatus((previous) => ({ ...previous, [key]: "online" }));
      setErrors((previous) => ({ ...previous, [key]: null }));
      return true;
    } catch (error) {
      if (signal?.aborted || requestVersions.current[key] !== version) return false;
      setStatus((previous) => ({ ...previous, [key]: "offline" }));
      setErrors((previous) => ({
        ...previous,
        [key]: `Could not load ${key}. ${error.message}`,
      }));
      return false;
    } finally {
      if (!signal?.aborted && requestVersions.current[key] === version) {
        setRefreshing((previous) => ({ ...previous, [key]: false }));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const refresh = async () => {
      await Promise.all(Object.keys(registries).map((key) => loadRecords(key, controller.signal)));
      if (!controller.signal.aborted) timer = setTimeout(refresh, 10000);
    };
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [loadRecords]);

  const mutateRecord = async (action, value, photo) => {
    const key = activeTab;
    const registry = registries[key];
    if (action === "delete" && !window.confirm(`Delete this ${registry.singular.toLowerCase()}? This cannot be undone.`)) {
      return false;
    }
    setBusy(true);
    setNotice(null);
    try {
      const url = `${registry.base}/${action}-${registry.singular.toLowerCase()}`;
      const response = await request(
        action === "delete" ? `${url}?${registry.idField}=${encodeURIComponent(value)}` : url,
        action === "delete"
          ? { method: "DELETE" }
          : {
              method: action === "add" ? "POST" : "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value),
            }
      );
      let photoWarning = "";
      if (action === "add" && photo) {
        try {
          const created = await response.json();
          if (!created.recordId) throw new Error("The registry did not return a stable photo ID.");
          await uploadPhoto(key, created.recordId, photo);
        } catch (failure) {
          photoWarning = ` The record is saved, but its photo upload failed. Use its photo button to choose the file again. ${failure.message}`;
        }
      }
      const refreshed = await loadRecords(key);
      const verb = { add: "added", update: "updated", delete: "deleted" }[action];
      setNotice({
        type: refreshed && !photoWarning ? "success" : "warning",
        text: `${registry.singular} ${verb}.${photoWarning || (photo ? " Photo uploaded; thumbnail processing." : "")}${refreshed ? "" : " The directory could not be refreshed. Retry loading before making further changes."}`,
      });
      return true;
    } catch (error) {
      setNotice({ type: "error", text: `Could not ${action} ${registry.singular.toLowerCase()}. ${error.message}` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (key) => {
    setActiveTab(key);
    setNotice(null);
  };

  const focusForm = () => {
    formHeading.current?.scrollIntoView({ block: "center" });
    formHeading.current?.focus({ preventScroll: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="#main-content" aria-label="Kindred School Registry">
          <span className="brand-mark"><Icon name="school" /></span>
          <span>kindred<span className="brand-subtitle">SCHOOL REGISTRY</span></span>
        </a>
        <div className="workspace-label">Your workspace</div>
        <nav className="sidebar-nav" aria-label="School directories">
          {Object.entries(registries).map(([key, registry]) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? "active" : ""}`}
              aria-current={activeTab === key ? "page" : undefined}
              onClick={() => switchTab(key)}
              disabled={busy}
            >
              <Icon name={registry.icon} />
              <span>{registry.label}</span>
              <span className="nav-count">{status[key] === "checking" ? "-" : records[key].length}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon"><Icon name="sparkles" /></span>
          <h3>A little more organized.</h3>
          <p>Less paperwork. More time for the people who make your school special.</p>
        </div>
        <div className="sidebar-footer"><Icon name="school" /><span>Made for your school community</span></div>
      </aside>

      <main id="main-content" className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>{config.label}</strong></div>
          <div className="topbar-meta">
            <span className="date-label">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date())}</span>
            <ProfileAvatar onNotice={setNotice} />
          </div>
        </header>

        <section className="welcome-section">
          <div>
            <span className="eyebrow"><span className="tiny-dot" /> A PLACE TO GROW</span>
            <h1>Your school, beautifully organized.</h1>
            <p>A clear view of your community. Everything you need, in one place.</p>
          </div>
          <button className="button button-primary" onClick={focusForm} disabled={busy || status[activeTab] !== "online"}>
            <Icon name="plus" /> Add {config.singular.toLowerCase()}
          </button>
        </section>

        <section className="summary-grid" aria-label="School overview">
          {Object.entries(registries).map(([key, registry]) => (
            <button
              key={key}
              className={`summary-card ${registry.color} ${key === activeTab ? "selected" : ""}`}
              onClick={() => switchTab(key)}
              disabled={busy}
              aria-label={`View ${registry.label.toLowerCase()}: ${status[key] === "checking" ? "loading" : records[key].length} records`}
            >
              <span className="summary-icon"><Icon name={registry.icon} /></span>
              <span className="summary-content">
                <span className="summary-label">{registry.label}</span>
                <strong>{status[key] === "checking" ? "-" : records[key].length}</strong>
                <span className="summary-caption">{status[key] === "offline" ? "Last available count" : registry.caption}</span>
              </span>
              <Icon name="arrow" className="summary-arrow" />
            </button>
          ))}
        </section>

        {notice && (
          <div className={`notice notice-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
            <Icon name={notice.type === "success" ? "check" : "info"} />
            <span>{notice.text}</span>
            <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" /></button>
          </div>
        )}

        <section className="directory-section" aria-labelledby="directory-heading">
          <div className="section-heading">
            <div><span className="eyebrow">YOUR COMMUNITY</span><h2 id="directory-heading">{config.label} directory</h2><p>{config.description}</p></div>
            <button className="button button-secondary" onClick={() => loadRecords(activeTab)} disabled={refreshing[activeTab] || busy}>
              <Icon name="refresh" className={refreshing[activeTab] ? "spinning" : ""} />
              {refreshing[activeTab] ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {errors[activeTab] && (
            <div className="notice notice-error" role="alert"><Icon name="info" /><span>{errors[activeTab]} Showing any previously loaded records; changes are disabled until the service reconnects.</span></div>
          )}
          <div className="directory-layout">
            <RecordList
              key={`list-${activeTab}`}
              config={config}
              records={records[activeTab]}
              loading={status[activeTab] === "checking"}
              unavailable={status[activeTab] === "offline"}
              disabled={busy || status[activeTab] !== "online"}
              onEdit={(record) => mutateRecord("update", record)}
              onDelete={(id) => mutateRecord("delete", id)}
              onAdd={focusForm}
              onNotice={setNotice}
            />
            <RecordForm
              key={`form-${activeTab}`}
              config={config}
              headingRef={formHeading}
              disabled={busy || status[activeTab] !== "online"}
              onAdd={(record, photo) => mutateRecord("add", record, photo)}
            />
          </div>
        </section>

        <footer className="main-footer">
          <span>Kindred <span className="footer-dot">/</span> Kindergarten School Registry</span>
          <div className="service-status" aria-label="Service connectivity">
            <span className={`status-dot ${onlineCount === 3 ? "online" : checking ? "checking" : "offline"}`} />
            <span>{checking ? "Connecting to services" : `${onlineCount} of 3 services connected`}</span>
            <div className="service-details">
              {Object.entries(registries).map(([key, registry]) => (
                <span key={key} title={`${registry.label}: ${status[key]}`}><span className={`status-dot ${status[key]}`} />{registry.label}</span>
              ))}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
