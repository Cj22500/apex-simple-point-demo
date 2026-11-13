import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api/client";

describe("api.uploadFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends FormData with file field, auth header, and parses JSON response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "tok-123", user: { id: "u1", name: "Demo", email: "demo@example.com" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ vertices: 10, triangles: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.login("demo@example.com");
    const file = new File(["dxf"], "design.dxf", { type: "application/dxf" });
    const res = await api.uploadFile<{ vertices: number; triangles: number }>("/projects/p1/design", file);

    expect(res).toEqual({ vertices: 10, triangles: 4 });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/design");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("throws ApiError with FastAPI JSON detail on HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "invalid SIMA encoding" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const file = new File(["bad"], "bad.sim");
    await expect(api.uploadFile("/projects/p1/import/sima", file)).rejects.toMatchObject({
      name: "Error",
      status: 400,
      message: "invalid SIMA encoding",
    } satisfies Partial<ApiError>);
  });
});

describe("ApiError structured code/params and api.download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("parses structured { detail, code, params } into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: "unsupported file type '.docx'; supported: .las, .laz",
            code: "UNSUPPORTED_FORMAT",
            params: { suffix: ".docx", supported: ".las, .laz" },
          }),
          {
            status: 400,
            statusText: "Bad Request",
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(api.get("/projects/p1/datasets")).rejects.toMatchObject({
      status: 400,
      message: "unsupported file type '.docx'; supported: .las, .laz",
      code: "UNSUPPORTED_FORMAT",
      params: { suffix: ".docx", supported: ".las, .laz" },
    } satisfies Partial<ApiError>);
  });

  it("ignores non-object params and falls back to statusText on non-JSON error bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "requires editor role", code: "ROLE_REQUIRED", params: ["editor"] }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("Gateway Timeout", {
          status: 504,
          statusText: "Gateway Timeout",
          headers: { "content-type": "text/plain" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.post("/projects/p1/measurements", {})).rejects.toMatchObject({
      status: 403,
      message: "requires editor role",
      code: "ROLE_REQUIRED",
      params: undefined,
    });

    await expect(api.del("/projects/p1/measurements/m1")).rejects.toMatchObject({
      status: 504,
      message: "Gateway Timeout",
      code: undefined,
      params: undefined,
    });
  });

  it("passes ?lang=en|ja query parameters cleanly through api.download for SIMA and DXF exports", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    const createObjectURL = vi.fn(() => "blob:dl-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Blob(["sima"]), { status: 200, headers: { "content-type": "application/octet-stream" } }))
      .mockResolvedValueOnce(new Response(new Blob(["dxf"]), { status: 200, headers: { "content-type": "application/dxf" } }))
      .mockResolvedValueOnce(new Response(new Blob(["profile"]), { status: 200, headers: { "content-type": "application/dxf" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.download("/projects/p1/export.sim?lang=ja", "survey_points.sim");
    await api.download("/projects/p1/export.dxf?lang=en", "survey_plan.dxf");
    await api.download("/datasets/d1/profile.dxf?lang=ja", "profile.dxf", { a: [0, 0], b: [10, 0] });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects/p1/export.sim?lang=ja");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/projects/p1/export.dxf?lang=en");
    const [profileUrl, profileInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(profileUrl).toBe("/api/datasets/d1/profile.dxf?lang=ja");
    expect(profileInit.method).toBe("POST");
    expect((profileInit.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(anchor.download).toBe("profile.dxf");
    expect(click).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});
