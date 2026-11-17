import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../app/AuthContext";
import { App } from "../app/App";

function renderApp(path = "/login") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("MARUT authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the first step of the two-step login", () => {
    renderApp();
    expect(screen.getAllByText("Admin Portal").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("Enter your email").length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Enter your password")).not.toBeInTheDocument();
  });

  it("reveals password entry only after the backend authorises the email", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authorised: true, can_login: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    const emailInputs = screen.getAllByPlaceholderText("Enter your email");
    fireEvent.change(emailInputs[0]!, {
      target: { value: "staff@marut.co.in" },
    });

    fireEvent.click(
      screen.getAllByRole("button", { name: /continue/i })[0]!
    );

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText("Enter your password").length).toBeGreaterThan(0);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/auth/check-email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "staff@marut.co.in" }),
      }),
    );
  });
});
