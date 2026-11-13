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
