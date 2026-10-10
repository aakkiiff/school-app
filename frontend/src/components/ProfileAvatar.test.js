import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfileAvatar from "./ProfileAvatar";
import { deletePhoto, getPhoto, retryPhoto, uploadPhoto } from "../profileApi";

jest.mock("../profileApi", () => ({
  ...jest.requireActual("../profileApi"),
  getPhoto: jest.fn(), uploadPhoto: jest.fn(), deletePhoto: jest.fn(), retryPhoto: jest.fn(),
}));

const image = (type = "image/png", size = 1024) => new File([new Uint8Array(size)], "photo", { type });
async function renderAvatar() {
  const onNotice = jest.fn();
  render(<ProfileAvatar onNotice={onNotice} />);
  const button = screen.getByRole("button", { name: "Edit profile photo" });
  await waitFor(() => expect(button).toBeEnabled());
  return { onNotice, button };
}
beforeEach(() => {
  getPhoto.mockResolvedValue({ imageUrl: null, status: "empty" });
  uploadPhoto.mockResolvedValue({ imageUrl: null, status: "processing" });
  deletePhoto.mockResolvedValue(null);
  retryPhoto.mockResolvedValue({ imageUrl: null, status: "processing" });
});
afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

test("shows initials and an upload menu", async () => {
  const { button } = await renderAvatar();
  expect(button).toHaveTextContent("K");
  fireEvent.click(button);
  expect(screen.getByRole("menuitem", { name: "Upload photo" })).toBeInTheDocument();
});
test("uploads a photo and retains the existing thumbnail while processing", async () => {
  getPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "ready" });
  const { onNotice } = await renderAvatar();
  getPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "processing" });
  uploadPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "processing" });
  const file = image();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [file] } });
  });
  expect(uploadPhoto).toHaveBeenCalledWith("school", "admin", file);
  expect(screen.getByRole("img", { name: "School profile" })).toHaveAttribute("src", "/media/old");
  expect(screen.getByText("Processing")).toBeInTheDocument();
  expect(onNotice).toHaveBeenCalledWith({ type: "success", text: "Photo submitted. Your thumbnail is processing." });
});
test("polls for thumbnail completion", async () => {
  jest.useFakeTimers();
  getPhoto.mockResolvedValue({ imageUrl: null, status: "processing" });
  await renderAvatar();
  getPhoto.mockResolvedValue({ imageUrl: "/media/new", status: "ready" });
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(screen.getByRole("img", { name: "School profile" })).toHaveAttribute("src", "/media/new");
  expect(screen.queryByText("Processing")).not.toBeInTheDocument();
});
test.each([
  ["image/gif", 100, "Choose a JPEG, PNG, or WebP image."],
  ["image/png", 5 * 1024 * 1024 + 1, "Images must be 5 MB or smaller."],
])("rejects %s files of %i bytes", async (type, size, message) => {
  const { onNotice } = await renderAvatar();
  fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [image(type, size)] } });
  expect(uploadPhoto).not.toHaveBeenCalled();
  expect(onNotice).toHaveBeenCalledWith({ type: "error", text: message });
});
test("reports upload errors", async () => {
  uploadPhoto.mockRejectedValueOnce(new Error("Storage unavailable"));
  const { onNotice } = await renderAvatar();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Upload profile photo"), { target: { files: [image()] } });
  });
  expect(onNotice).toHaveBeenCalledWith({ type: "error", text: "Could not upload profile photo. Storage unavailable" });
});
test("removes a processing photo even before a thumbnail exists", async () => {
  getPhoto.mockResolvedValue({ imageUrl: null, status: "processing" });
  const { button } = await renderAvatar();
  getPhoto.mockResolvedValue({ imageUrl: null, status: "empty" });
  fireEvent.click(button);
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Remove photo" })); });
  expect(deletePhoto).toHaveBeenCalledWith("school", "admin");
  expect(screen.queryByText("Processing")).not.toBeInTheDocument();
});
test("retries a failed thumbnail", async () => {
  getPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "failed", error: "Failed to process" });
  const { button } = await renderAvatar();
  getPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "processing" });
  fireEvent.click(button);
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Retry thumbnail" })); });
  expect(retryPhoto).toHaveBeenCalledWith("school", "admin");
  expect(screen.getByText("Processing")).toBeInTheDocument();
});
test("refreshes an expired presigned URL", async () => {
  getPhoto.mockResolvedValue({ imageUrl: "/media/old", status: "ready" });
  await renderAvatar();
  getPhoto.mockResolvedValue({ imageUrl: "/media/new", status: "ready" });
  await act(async () => { fireEvent.error(screen.getByRole("img", { name: "School profile" })); });
  expect(screen.getByRole("img", { name: "School profile" })).toHaveAttribute("src", "/media/new");
});
test("shows offline status and reconnect action", async () => {
  getPhoto.mockRejectedValue(new Error("offline"));
  const { button } = await renderAvatar();
  fireEvent.click(button);
  expect(screen.getByText("Photo offline")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument();
});
