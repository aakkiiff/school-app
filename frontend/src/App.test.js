import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { registries } from "./registry";
import { getPhoto, uploadPhoto } from "./profileApi";

jest.mock("./profileApi", () => ({
  ...jest.requireActual("./profileApi"),
  getPhoto: jest.fn(async () => ({ imageUrl: null, status: "empty" })),
  uploadPhoto: jest.fn(async () => ({ imageUrl: null, status: "processing" })),
}));

let store;
let originalFetch;

const response = (data, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => data,
});

beforeEach(() => {
  getPhoto.mockResolvedValue({ imageUrl: null, status: "empty" });
  uploadPhoto.mockResolvedValue({ imageUrl: null, status: "processing" });
  originalFetch = global.fetch;
  store = {
    students: [
      { name: "Zoe Morgan", roll: "ST-002", address: "24 Maple Avenue" },
      { name: "Avery Parker", roll: "ST-001", address: "12 Oak Street" },
    ],
    teachers: [{ name: "Jamie Lane", id: "TC-001", subject: "Early learning" }],
    employees: [{ name: "Riley Bennett", id: "EM-001", position: "Administrator" }],
  };
  Object.entries(store).forEach(([kind, items]) => {
    items.forEach((record, index) => { record.recordId = `${kind}-${index}`; });
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    const key = Object.keys(registries).find((name) => url.startsWith(registries[name].base));
    if (!key) throw new Error(`Unexpected URL: ${url}`);
    const registry = registries[key];
    if (!options.method || options.method === "GET") return response(store[key]);
    if (options.method === "POST") {
      const created = { ...JSON.parse(options.body), recordId: `${key}-new` };
      store[key] = [...store[key], created];
      return response(created, true, 201);
    } else if (options.method === "PUT") {
      const updated = JSON.parse(options.body);
      store[key] = store[key].map((record) => record[registry.idField] === updated[registry.idField] ? updated : record);
    } else if (options.method === "DELETE") {
      const id = new URL(url, "http://localhost").searchParams.get(registry.idField);
      store[key] = store[key].filter((record) => record[registry.idField] !== id);
    }
    return response({});
  });
});

afterEach(async () => {
  await act(async () => {});
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function openDirectory(key = "students") {
  render(<App />);
  await screen.findByText("3 of 3 services connected");
  if (key !== "students") {
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: new RegExp(registries[key].label) }));
    });
  }
}

test("renders the dashboard with live counts and one initial request per service", async () => {
  await openDirectory();
  expect(screen.getByRole("heading", { name: "Your school, beautifully organized." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View students: 2 records" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View teachers: 1 records" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Small details. A stronger community." })).not.toBeInTheDocument();
  expect(screen.queryByText(/people in your registry/)).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test.each(Object.keys(registries))("creates %s before uploading its optional photo", async (key) => {
  await openDirectory(key);
  const config = registries[key];
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Photo Person" } });
  fireEvent.change(screen.getByLabelText(new RegExp(config.idLabel)), { target: { value: "PHOTO-1" } });
  fireEvent.change(screen.getByLabelText(new RegExp(config.detailLabel)), { target: { value: "Detail" } });
  const file = new File(["image"], "photo.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText(`Photo for new ${config.singular.toLowerCase()}`), { target: { files: [file] } });
  const buttons = screen.getAllByRole("button", { name: `Add ${config.singular.toLowerCase()}` });
  fireEvent.click(buttons[buttons.length - 1]);
  await screen.findByText("Photo Person");
  expect(uploadPhoto).toHaveBeenCalledWith(key, `${key}-new`, file);
  expect(screen.getByText(`${config.singular} added. Photo uploaded; thumbnail processing.`)).toBeInTheDocument();
});

test("does not resubmit a saved record when its optional photo upload fails", async () => {
  uploadPhoto.mockRejectedValueOnce(new Error("Storage offline"));
  await openDirectory();
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Saved Person" } });
  fireEvent.change(screen.getByLabelText(/Roll number/), { target: { value: "PHOTO-1" } });
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "Detail" } });
  fireEvent.change(screen.getByLabelText("Photo for new student"), {
    target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
  });
  const buttons = screen.getAllByRole("button", { name: "Add student" });
  fireEvent.click(buttons[buttons.length - 1]);
  await screen.findByText("Saved Person");
  expect(screen.getByLabelText(/Full name/)).toHaveValue("");
  expect(screen.getByText(/record is saved, but its photo upload failed/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

test("searches across fields and sorts the visible records", async () => {
  await openDirectory();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "oak" } });
  expect(screen.getByText("Avery Parker")).toBeInTheDocument();
  expect(screen.queryByText("Zoe Morgan")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  expect(screen.getByText("No matches just yet")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clear search" })); });
  fireEvent.change(screen.getByRole("combobox", { name: "Sort records" }), { target: { value: "asc" } });
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Avery Parker");
  expect(rows[1]).toHaveTextContent("Zoe Morgan");
});

test.each(Object.keys(registries))("preserves add, edit, and delete API workflows for %s", async (key) => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  await openDirectory(key);
  const config = registries[key];
  const id = "ID /&1";
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: " New Person " } });
  fireEvent.change(screen.getByLabelText(new RegExp(config.idLabel)), { target: { value: id } });
  fireEvent.change(screen.getByLabelText(new RegExp(config.detailLabel)), { target: { value: " New detail " } });
  const submitButtons = screen.getAllByRole("button", { name: `Add ${config.singular.toLowerCase()}` });
  fireEvent.click(submitButtons[submitButtons.length - 1]);
  await screen.findByText("New Person");
  expect(screen.getByLabelText(/Full name/)).toHaveValue("");
  expect(global.fetch).toHaveBeenCalledWith(`${config.base}/add-${config.singular.toLowerCase()}`, expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ name: "New Person", [config.idField]: id, [config.detailField]: "New detail" }),
  }));

  fireEvent.click(screen.getByRole("button", { name: "Edit New Person" }));
  const editForm = screen.getByRole("form", { name: "Edit New Person" });
  expect(within(editForm).getByLabelText(config.idLabel)).toBeDisabled();
  fireEvent.change(within(editForm).getByLabelText("Full name"), { target: { value: "Updated Person" } });
  fireEvent.click(within(editForm).getByRole("button", { name: "Save changes" }));
  await screen.findByText("Updated Person");
  expect(global.fetch).toHaveBeenCalledWith(`${config.base}/update-${config.singular.toLowerCase()}`, expect.objectContaining({ method: "PUT" }));

  fireEvent.click(screen.getByRole("button", { name: "Delete Updated Person" }));
  await waitFor(() => expect(screen.queryByText("Updated Person")).not.toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith(`${config.base}/delete-${config.singular.toLowerCase()}?${config.idField}=${encodeURIComponent(id)}`, expect.objectContaining({ method: "DELETE" }));
});

test("retains add form values and displays an error when the API rejects a save", async () => {
  await openDirectory();
  global.fetch.mockResolvedValueOnce(response({ error: "Duplicate" }, false, 409));
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "New Person" } });
  fireEvent.change(screen.getByLabelText(/Roll number/), { target: { value: "ST-001" } });
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "Maple Avenue" } });
  const buttons = screen.getAllByRole("button", { name: "Add student" });
  fireEvent.click(buttons[buttons.length - 1]);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not add student. Request failed (409)");
  expect(screen.getByLabelText(/Full name/)).toHaveValue("New Person");
});

test("keeps the edit form open if saving fails", async () => {
  await openDirectory();
  fireEvent.click(screen.getByRole("button", { name: "Edit Zoe Morgan" }));
  const form = screen.getByRole("form", { name: "Edit Zoe Morgan" });
  fireEvent.change(within(form).getByLabelText("Full name"), { target: { value: "Zoe Updated" } });
  global.fetch.mockResolvedValueOnce(response({}, false, 500));
  fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not update student");
  expect(within(form).getByLabelText("Full name")).toHaveValue("Zoe Updated");
});

test("does not delete when confirmation is cancelled", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(false);
  await openDirectory();
  fireEvent.click(screen.getByRole("button", { name: "Delete Zoe Morgan" }));
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByText("Zoe Morgan")).toBeInTheDocument();
});

test("shows a service error, disables changes, and recovers on refresh", async () => {
  global.fetch.mockRejectedValueOnce(new Error("Network unavailable"));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load students");
  expect(screen.getByText("Your directory is unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View teachers: 1 records" })).toBeEnabled();
  expect(screen.getAllByRole("button", { name: "Add student" })[0]).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("Zoe Morgan");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("accepts the student service's null empty collection", async () => {
  global.fetch.mockResolvedValueOnce(response(null));
  await openDirectory();
  expect(screen.getByText("A fresh start for your community")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View students: 0 records" })).toBeInTheDocument();
});

test("reports malformed list responses instead of showing an empty healthy directory", async () => {
  global.fetch.mockResolvedValueOnce(response({ error: "Unexpected response" }));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("unexpected response");
  expect(screen.getByText("Your directory is unavailable")).toBeInTheDocument();
});

test("rejects whitespace-only fields without sending a mutation", async () => {
  await openDirectory();
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: " " } });
  fireEvent.change(screen.getByLabelText(/Roll number/), { target: { value: "ST-003" } });
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "Maple Avenue" } });
  const buttons = screen.getAllByRole("button", { name: "Add student" });
  fireEvent.click(buttons[buttons.length - 1]);
  expect(screen.getByRole("alert")).toHaveTextContent("Spaces alone are not valid");
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test("keeps last loaded records visible when a refresh fails", async () => {
  await openDirectory();
  global.fetch.mockRejectedValueOnce(new Error("Network unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
  expect(screen.getByText("Zoe Morgan")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Zoe Morgan" })).toBeDisabled();
  expect(screen.getByText("Showing last available records")).toBeInTheDocument();
});

test("does not report a successful save as a failed mutation when its refresh fails", async () => {
  await openDirectory();
  global.fetch.mockResolvedValueOnce(response({}));
  global.fetch.mockRejectedValueOnce(new Error("Network unavailable"));
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "New Person" } });
  fireEvent.change(screen.getByLabelText(/Roll number/), { target: { value: "ST-003" } });
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "Maple Avenue" } });
  const buttons = screen.getAllByRole("button", { name: "Add student" });
  fireEvent.click(buttons[buttons.length - 1]);
  expect(await screen.findByRole("status")).toHaveTextContent("Student added. The directory could not be refreshed.");
  expect(screen.getByLabelText(/Full name/)).toHaveValue("");
});

test("shows a helpful API connection error for non-JSON responses", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => { throw new SyntaxError("Unexpected token <"); },
  });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The service did not return valid JSON. Check the API connection.");
});

test("times out unavailable services instead of leaving the dashboard loading indefinitely", async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }));
  render(<App />);
  expect(screen.getByRole("status", { name: "Loading records" })).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(screen.getByRole("alert")).toHaveTextContent("The service took too long to respond");
  expect(screen.getByText("0 of 3 services connected")).toBeInTheDocument();
});
