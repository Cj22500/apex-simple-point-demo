import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadCsv,
  formatGradeDegrees,
  formatGradePercent,
  formatNumber,
  formatProjectCrs,
} from "../src/geo/format";

describe("formatGradePercent and formatGradeDegrees", () => {
  it("formats numeric grades and vertical fallback in en and ja", () => {
    expect(formatGradePercent(5.01)).toBe("5.010 %");
    expect(formatGradePercent(5.01, "en")).toBe("5.010 %");
    expect(formatGradePercent(5.01, "ja")).toBe("5.010 %");
    expect(formatGradePercent(null)).toBe("vertical");
    expect(formatGradePercent(null, "en")).toBe("vertical");
    expect(formatGradePercent(null, "ja")).toBe("鉛直");

    expect(formatGradeDegrees(2.8682)).toBe("2.8682°");
    expect(formatGradeDegrees(2.8682, "ja")).toBe("2.8682°");
    expect(formatGradeDegrees(null)).toBe("vertical");
    expect(formatGradeDegrees(null, "en")).toBe("vertical");
    expect(formatGradeDegrees(null, "ja")).toBe("鉛直");
  });
});

describe("formatNumber", () => {
  it("formats numbers using locale grouping in en and ja", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "ja")).toBe("1,234,567");
    expect(formatNumber(12.345, "ja", { maximumFractionDigits: 1 })).toBe("12.3");
  });
});

describe("formatProjectCrs", () => {
  it("formats EPSG:6677+EPSG:6695 with default JPGEO2024 heights", () => {
    expect(formatProjectCrs("EPSG:6677+EPSG:6695")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
    expect(formatProjectCrs("EPSG:6677+EPSG:6695", "jpgeo2024")).toBe("JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights");
  });

  it("formats Japanese Zone IX CRS and geoid label when lang='ja'", () => {
    expect(formatProjectCrs("EPSG:6677+EPSG:6695", "jpgeo2024", "ja")).toBe(
      "平面直角座標系第IX系 JGD2011 (EPSG:6677) · JPGEO2024 標高",
    );
    expect(formatProjectCrs(undefined, "gsigeo2011", "ja")).toBe(
      "平面直角座標系第IX系 JGD2011 (EPSG:6677) · GSIGEO2011 標高",
    );
    expect(formatProjectCrs("EPSG:32654", "egm2008", "ja")).toBe("EPSG:32654 · EGM2008 標高");
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

  it("creates a CSV blob URL with UTF-8 BOM, clicks anchor, and revokes after 1000 ms", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    const createObjectURL = vi.fn(() => "blob:csv-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });

    downloadCsv("profile.csv", "距離程_m,標高_m\n0.0000,3.0000");

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe("\uFEFF距離程_m,標高_m\n0.0000,3.0000");
    expect(anchor.href).toBe("blob:csv-1");
    expect(anchor.download).toBe("profile.csv");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv-1");
  });

  it("does not duplicate UTF-8 BOM if input already starts with one", async () => {
    const anchor = { href: "", download: "", click: vi.fn() };
    const createObjectURL = vi.fn(() => "blob:csv-2");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });

    downloadCsv("already.csv", "\uFEFFa,b\n1,2");

    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe("text/csv");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe("\uFEFFa,b\n1,2");
  });
});
