import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, navigate, readRoute, useRoute } from "./router";

describe("router", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.location.hash = "";
  });

  it("defaults to 'board' when on root path '/'", () => {
    window.history.replaceState(null, "", "/");
    expect(readRoute()).toBe("board");
  });

  it("reads pathname correctly without leading slash", () => {
    window.history.replaceState(null, "", "/workspaces");
    expect(readRoute()).toBe("workspaces");

    window.history.replaceState(null, "", "/task/task-123");
    expect(readRoute()).toBe("task/task-123");
  });

  it("migrates legacy hash routes like '#/pipelines' to clean path '/pipelines'", () => {
    window.location.hash = "#/pipelines";
    expect(readRoute()).toBe("pipelines");
    expect(window.location.pathname).toBe("/pipelines");
    expect(window.location.hash).toBe("");
  });

  it("migrates legacy hash route with argument like '#/task/xyz'", () => {
    window.location.hash = "#/task/xyz";
    expect(readRoute()).toBe("task/xyz");
    expect(window.location.pathname).toBe("/task/xyz");
  });

  it("navigate pushes new history state and dispatches route update", () => {
    function RouteDisplay() {
      const route = useRoute();
      return <div data-testid="active-route">{route}</div>;
    }

    render(<RouteDisplay />);
    expect(screen.getByTestId("active-route").textContent).toBe("board");

    act(() => {
      navigate("/flow");
    });
    expect(window.location.pathname).toBe("/flow");
    expect(screen.getByTestId("active-route").textContent).toBe("flow");

    act(() => {
      navigate("review/task-1");
    });
    expect(window.location.pathname).toBe("/review/task-1");
    expect(screen.getByTestId("active-route").textContent).toBe("review/task-1");
  });

  it("<Link> intercepts normal left click and navigates without page reload", () => {
    function TestApp() {
      const route = useRoute();
      return (
        <div>
          <span data-testid="route">{route}</span>
          <Link href="/workers" data-testid="nav-link">
            Workers
          </Link>
        </div>
      );
    }

    render(<TestApp />);
    expect(screen.getByTestId("route").textContent).toBe("board");

    const link = screen.getByTestId("nav-link");
    expect(link.getAttribute("href")).toBe("/workers");

    fireEvent.click(link);
    expect(window.location.pathname).toBe("/workers");
    expect(screen.getByTestId("route").textContent).toBe("workers");
  });
});
