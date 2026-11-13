import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import {
  en,
  formatControlPointName,
  formatDatasetName,
  formatDesignSource,
  formatProjectName,
  ja,
  localizeError,
  t,
  type I18nKey,
} from "../src/i18n";

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("i18n dictionaries", () => {
  it("has identical, non-empty keys and matching placeholders between en and ja", () => {
    const enKeys = Object.keys(en).sort();
    const jaKeys = Object.keys(ja).sort();
    expect(jaKeys).toEqual(enKeys);

    for (const key of enKeys as I18nKey[]) {
      expect(en[key].trim().length, `empty en[${key}]`).toBeGreaterThan(0);
      expect(ja[key].trim().length, `empty ja[${key}]`).toBeGreaterThan(0);
      expect(extractPlaceholders(ja[key]), `placeholder mismatch for ${key}`).toEqual(extractPlaceholders(en[key]));
    }
  });
});

describe("t() interpolation", () => {
  it("interpolates all placeholders cleanly in both en and ja with zero unresolved markers", () => {
    const sampleParams: Record<string, string | number> = {
      detail: "boom",
      count: 42,
      name: "scan.laz",
      points: 1000,
      sec: "1.2",
      mm: "12.5",
      vis: "1.5",
      bud: "2.0",
      nodes: 12,
      pending: 3,
      mb: 64,
      x: "1.0000",
      y: "2.0000",
      h: "3.0000",
      model: "JPGEO2024",
      stockpile: "351.949",
      pit: "120.000",
      kind: "seeded",
      source: "design.dxf",
      tris: 18,
      task: "Cleaning",
      removed: 10,
      threshold: "0.150",
      kept: 990,
      verdict: "PASS",
      ok: 10,
      total: 12,
      parcels: 2,
      encoding: "cp932",
      warnings: "",
      length: "40.000",
      zMin: "3.00",
      zMax: "5.00",
      s: "10.000",
      z: "3.500",
      dS: "5.0000",
      dZ: "0.2500",
      grade: "5.000",
      filename: "DJI_0001.JPG",
      yaw: "45.0",
      pitch: "-60.0",
    };

    for (const key of Object.keys(en) as I18nKey[]) {
      for (const lang of ["en", "ja"] as const) {
        const out = t(lang, key, sampleParams);
        expect(out, `unresolved placeholder in ${lang}[${key}]: ${out}`).not.toMatch(/\{\w+\}/);
      }
    }

    expect(t("en", "layers.points", { count: "1.23" })).toBe("1.23 M pts");
    expect(t("ja", "layers.points", { count: "1.23" })).toBe("1.23 M 点");
    expect(t("en", "report.verdict", { verdict: t("en", "report.pass") })).toBe("PASS · As-built (MLIT)");
    expect(t("ja", "report.verdict", { verdict: t("ja", "report.fail") })).toBe("不合格 · 出来形 (MLIT 面管理)");
  });

  it("leaves unknown placeholders intact when params are omitted", () => {
    expect(t("en", "layers.points")).toBe("{count} M pts");
    expect(t("ja", "layers.points", { other: 1 })).toBe("{count} M 点");
  });
});

describe("domain name formatters", () => {
  it("formats control point names in en and ja", () => {
    expect(formatControlPointName(1, "基準点1", "en")).toBe("CP-1");
    expect(formatControlPointName(1, "基準点1", "ja")).toBe("基準点1");
    expect(formatControlPointName(4, "", "ja")).toBe("基準点4");
  });

  it("formats known project names bidirectionally and passes through custom names", () => {
    expect(formatProjectName("Toyosu Construction Site (synthetic)", "en")).toBe("Toyosu Construction Site (synthetic)");
    expect(formatProjectName("Toyosu Construction Site (synthetic)", "ja")).toBe("豊洲建設現場（合成デモ）");
    expect(formatProjectName("豊洲建設現場（合成デモ）", "en")).toBe("Toyosu Construction Site (synthetic)");
    expect(formatProjectName("Other tenant's private project", "ja")).toBe("他テナントの非公開プロジェクト");
    expect(formatProjectName("他テナントの非公開プロジェクト", "en")).toBe("Other tenant's private project");
    expect(formatProjectName("Custom Site", "ja")).toBe("Custom Site");
  });

  it("formats epoch, cleaned, delta-Z, and as-built dataset names in en and ja", () => {
    const epochA = { name: "Epoch A: 2026-10-01 TLS scan" };
    const epochB = { name: "Epoch B: 2026-11-01 TLS scan" };
    expect(formatDatasetName(epochA, "en")).toBe("Epoch A: 2026-10-01 TLS scan");
    expect(formatDatasetName(epochA, "ja")).toBe("エポックA: 2026-10-01 TLSスキャン");
    expect(formatDatasetName({ name: "エポックB: 2026-11-01 TLSスキャン" }, "en")).toBe("Epoch B: 2026-11-01 TLS scan");
    expect(formatDatasetName(epochB, "ja")).toBe("エポックB: 2026-11-01 TLSスキャン");

    const cleaned = { name: "Epoch A: 2026-10-01 TLS scan (cleaned)" };
    expect(formatDatasetName(cleaned, "ja")).toBe("エポックA: 2026-10-01 TLSスキャン（ノイズ除去）");
    expect(formatDatasetName({ name: "エポックA: 2026-10-01 TLSスキャン（ノイズ除去）" }, "en")).toBe(
      "Epoch A: 2026-10-01 TLS scan (cleaned)",
    );

    const change = { name: "ΔZ B vs A" };
    expect(formatDatasetName(change, "en")).toBe("ΔZ B vs A");
    expect(formatDatasetName(change, "ja")).toBe("ΔZ B 対 A");
    expect(formatDatasetName({ name: "ΔZ エポックB: 2026-11-01 TLSスキャン 対 エポックA: 2026-10-01 TLSスキャン（ノイズ除去）" }, "en")).toBe(
      "ΔZ Epoch B: 2026-11-01 TLS scan vs Epoch A: 2026-10-01 TLS scan (cleaned)",
    );

    const asbuilt = { name: "As-built deviation: Epoch A: 2026-10-01 TLS scan (cleaned)" };
    expect(formatDatasetName(asbuilt, "ja")).toBe("出来形偏差: エポックA: 2026-10-01 TLSスキャン（ノイズ除去）");
    expect(formatDatasetName({ name: "出来形偏差: custom.las" }, "en")).toBe("As-built deviation: custom.las");
  });

  it("formats seeded and uploaded design sources", () => {
    expect(formatDesignSource("synthetic design (pad + 1:0.5 pit)", "en", "synthetic_design")).toEqual({
      isSeeded: true,
      label: "synthetic design (pad + 1:0.5 pit)",
    });
    expect(formatDesignSource("synthetic design (pad + 1:0.5 pit)", "ja", "synthetic_design")).toEqual({
      isSeeded: true,
      label: "合成設計データ（平坦部＋1:0.5掘削法面）",
    });
    expect(formatDesignSource("custom_tin.dxf", "ja", "uploaded")).toEqual({
      isSeeded: false,
      label: "custom_tin.dxf",
    });
  });
});

describe("localizeError", () => {
  const backendCases: Array<{ code: string; params?: Record<string, unknown>; detail?: string }> = [
    { code: "AUTH_INVALID_TOKEN" },
    { code: "PROJECT_NOT_FOUND" },
    { code: "ROLE_REQUIRED", params: { role: "editor" } },
    { code: "DATASET_NOT_FOUND" },
    { code: "JOB_NOT_FOUND" },
    { code: "HIERARCHY_NOT_FOUND" },
    { code: "NODE_NOT_FOUND" },
    { code: "POINT_CLOUD_TOO_SMALL" },
    { code: "UNSUPPORTED_FORMAT", params: { suffix: ".docx", supported: ".las, .laz" } },
    { code: "UPLOAD_INVALID_CLOUD", params: { detail: "bad header" } },
    { code: "DATASET_NOT_READY", params: { status: "processing" } },
    { code: "CANNOT_DELETE_BASE_DATASET" },
    { code: "POINT_EXCEEDS_MAX", params: { max: 5000000 } },
    { code: "TOO_FEW_POINTS_IN_POLYGON" },
    { code: "DATASETS_DIFFERENT_PROJECTS" },
    { code: "NO_DESIGN_SURFACE" },
    { code: "INVALID_DESIGN_DXF", params: { detail: "no 3DFACE entities found" } },
    { code: "MISSING_DESIGN_SURFACE" },
    { code: "SIMA_NO_RECORDS" },
    { code: "PHOTO_NO_GPS", params: { detail: "missing EXIF GPS" } },
    { code: "PHOTO_NOT_FOUND" },
    { code: "INVALID_VALUE", params: { detail: "zero-length section" } },
    { code: "CRS_OUTSIDE_GEOID", params: { detail: "outside JPGEO2024 grid" } },
  ];

  it("localizes every backend ERR_* code from ApiError or structured JSON in en and ja", () => {
    for (const c of backendCases) {
      const apiErr = new ApiError(400, c.detail ?? "raw detail", c.code, c.params);
      const prefixed = { message: "raw detail", code: `ERR_${c.code}`, params: c.params };
      for (const lang of ["en", "ja"] as const) {
        const msg1 = localizeError(apiErr, lang);
        const msg2 = localizeError(prefixed, lang);
        expect(msg1.length).toBeGreaterThan(0);
        expect(msg1).toBe(msg2);
        expect(msg1).not.toMatch(/\{\w+\}/);
      }
      expect(localizeError(apiErr, "ja")).not.toBe(localizeError(apiErr, "en"));
    }

    expect(localizeError(new ApiError(403, "requires editor role", "ROLE_REQUIRED", { role: "editor" }), "ja")).toBe(
      "編集者 権限が必要です。",
    );
    expect(localizeError(new ApiError(409, "dataset is processing", "DATASET_NOT_READY", { status: "processing" }), "ja")).toBe(
      "データセットは現在「処理中」のため実行できません。",
    );
  });

  it("localizes offline and 3D engine error codes and fallback raw patterns", () => {
    const engineCodes: Array<{ err: unknown; enMatch: RegExp; jaMatch: RegExp }> = [
      { err: { code: "ERR_NOT_LAS_FILE", message: "ERR_NOT_LAS_FILE: not a LAS/LAZ file" }, enMatch: /LAS\/LAZ/, jaMatch: /有効な LAS\/LAZ/ },
      { err: { code: "ERR_LAZ_WASM_REQUIRED", message: "ERR_LAZ_WASM_REQUIRED: LAZ needs the laz-perf WASM module" }, enMatch: /laz-perf/, jaMatch: /laz-perf/ },
      { err: { code: "ERR_EMPTY_POINT_CLOUD", message: "ERR_EMPTY_POINT_CLOUD: empty point cloud" }, enMatch: /no points/, jaMatch: /1 つも含まれていません/ },
      { err: { code: "ERR_TOO_MANY_RESIDENT_NODES", message: "ERR_TOO_MANY_RESIDENT_NODES: too many resident nodes" }, enMatch: /Too many resident/, jaMatch: /常駐八分木ノード数/ },
      {
        err: { code: "ERR_NODE_SIZE_MISMATCH", message: "ERR_NODE_SIZE_MISMATCH: node size 10 B, expected 22 B for 1 points", params: { actual: 10, expected: 22 } },
        enMatch: /10 B.*22 B/,
        jaMatch: /10 B.*22 B/,
      },
      {
        err: { code: "ERR_NODE_BYTE_SIZE", message: "node size 10 B, expected 22 B for 1 points", params: { actual: 10, expected: 22, count: 1 } },
        enMatch: /10 B.*22 B.*1 points/,
        jaMatch: /10 B.*22 B.*1 点/,
      },
    ];

    for (const tc of engineCodes) {
      expect(localizeError(tc.err, "en")).toMatch(tc.enMatch);
      expect(localizeError(tc.err, "ja")).toMatch(tc.jaMatch);
    }

    expect(localizeError(new Error("too many resident nodes"), "ja")).toContain("常駐八分木ノード数");
    expect(localizeError(new Error("not a LAS/LAZ file"), "ja")).toContain("LAS/LAZ");
    expect(localizeError(new Error("LAZ needs the laz-perf WASM module"), "ja")).toContain("WASM");
    expect(localizeError(new Error("empty point cloud"), "ja")).toContain("点群");
    expect(localizeError("no project available", "ja")).toBe("利用可能なプロジェクトがありません。");
    expect(localizeError(new Error("missing node r012"), "ja")).toBe("八分木ノード r012 が見つかりません。");
    expect(localizeError(new Error("node size 40 B, expected 88 B for 4 points"), "ja")).toBe(
      "ノードサイズが不正です（40 B / 期待値 88 B・4 点）。",
    );
    expect(localizeError("ERR_DATASET_NOT_FOUND: dataset not found", "ja")).toBe("データセットが見つかりません。");
    expect(localizeError(new Error("unexpected failure"), "ja")).toBe("unexpected failure");
  });
});
