import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsv, formatProjectCrs } from "../src/geo/format";

describe("formatProjectCrs", () => {
  it("formats EPSG:6677+EPSG:6695 with default JPGEO2024 heights", () => {
    expect(formatProjectCrs("EPSG:6677+EPSG:6695")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
    expect(formatProjectCrs("EPSG:6677+EPSG:6695", "jpgeo2024")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
  });

  it("uppercases custom geoid models", () => {
    expect(formatProjectCrs("EPSG:6677+EPSG:6695", "gsigeo2011")).toBe("JGD2011 Zone IX (EPSG:6677) · GSIGEO2011 heights");
    expect(formatProjectCrs(undefined, "constant")).toBe("JGD2011 Zone IX (EPSG:6677) · CONSTANT heights");
  });

  it("handles bare EPSG:6677 and omitted CRS cleanly", () => {
    expect(formatProjectCrs()).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
    expect(formatProjectCrs("EPSG:6677")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
    expect(formatProjectCrs("epsg:6677+6695")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
  });

  it("falls back cleanly for other CRS strings", () => {
    expect(formatProjectCrs("EPSG:32654", "egm2008")).toBe("EPSG:32654 · EGM2008 heights");
    expect(formatProjectCrs("EPSG:6678+EPSG:6695")).toBe("EPSG:6678+EPSG:6695 · JPGEO2024 heights");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates a CSV blob URL, clicks anchor, and revokes after 1000 ms", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    const createObjectURL = vi.fn(() => "blob:csv-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });

    downloadCsv("profile.csv", "a,b\n1,2");

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv");
    expect(anchor.href).toBe("blob:csv-1");
    expect(anchor.download).toBe("profile.csv");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv-1");
  });
});
