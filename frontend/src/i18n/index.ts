/** Bilingual dictionary (EN / JA) and domain formatting/error localization helpers. */

export type Lang = "en" | "ja";

export const en = {
  "app.title": "Simple-Point Lite",
  "app.startupFailed": "Startup failed: {detail}. Please check that the backend API is running.",
  "app.noProject": "No project available.",

  "lang.aria": "Language",

  "toolbar.aria": "Tools",
  "tool.navigate.label": "Navigate",
  "tool.navigate.hint": "Drag to orbit, right-drag to pan, wheel to zoom, double-click to focus",
  "tool.point.label": "Point",
  "tool.point.hint": "Click a point to read its JGD2011 coordinates",
  "tool.distance.label": "Distance",
  "tool.distance.hint": "Click two points: 3D/horizontal distance, ΔX/ΔY/ΔH, grade",
  "tool.polyline.label": "Polyline",
  "tool.polyline.hint": "Click points, double-click or Enter to finish",
  "tool.area.label": "Area",
  "tool.area.hint": "Click polygon vertices, double-click or Enter to finish (plan area)",
  "tool.section.label": "Section",
  "tool.section.hint": "Click two points to cut a cross-section",
  "tool.volume.label": "Volume",
  "tool.volume.hint": "Click a polygon, Enter to compute cut/fill",
  "tool.asbuilt.label": "As-built",
  "tool.asbuilt.hint": "Run MLIT as-built check or upload/download the design TIN (DXF) in the right panel",

  "project.heading": "Project",

  "layers.heading": "Layers",
  "layers.seeding": "Initializing demo datasets…",
  "layers.points": "{count} M pts",
  "layers.status.processing": "processing",
  "layers.status.failed": "failed",
  "layers.deleteTitle": "Delete this derived dataset",
  "layers.upload": "+ Upload LAS/LAZ/E57/PLY/PTS/XYZ",
  "layers.ingestFailed": "Ingest failed: {detail}",

  "offline.heading": "Offline (local file, WASM)",
  "offline.open": "+ Open LAS/LAZ locally (not uploaded)",
  "offline.localTag": "{count} M pts · local",
  "offline.closeTitle": "Close",
  "offline.reading": "Reading {name}…",
  "offline.decoding": "Decoding (WASM)",
  "offline.buildingOctree": "Building octree",
  "offline.failed": "Failed: {detail}",
  "offline.opened": "Opened {name}: {points} points in {sec} s, no server involved",

  "color.heading": "Color",
  "color.rgb": "RGB",
  "color.elevation": "Elevation",
  "color.intensity": "Intensity",
  "color.classification": "Classification",
  "color.change": "Change ΔZ",
  "color.minH": "min H",
  "color.maxH": "max H",
  "color.range": "±range",
  "color.lower": "−{mm} mm (lower)",
  "color.higher": "+{mm} mm (higher)",
  "color.noDz": "Run Change detection (right panel) to compute ΔZ.",

  "render.heading": "Rendering",
  "render.pointBudget": "Point budget",
  "render.pointSize": "Point size",
  "render.adaptive": "Adaptive size (LOD spacing)",
  "render.edl": "Eye-Dome Lighting",
  "render.resetView": "Reset view",

  "hud.aria": "Rendering statistics",
  "hud.fps": "FPS",
  "hud.pts": "{vis} M / {bud} M pts",
  "hud.nodes": "{nodes} nodes · {pending} loading",
  "hud.gpu": "GPU ≈ {mb} MB",

  "status.coords": "X {x} · Y {y} · H {h} m",
  "status.dz": " · ΔZ {mm} mm",
  "status.idle": "Hover the cloud to read JGD2011 plane coordinates (X = north, Y = east)",
  "status.dismiss": "dismiss",

  "pick.heading": "Last picked point",
  "pick.xNorth": "X (north)",
  "pick.yEast": "Y (east)",
  "pick.h": "H (Elevation)",
  "pick.lat": "Lat",
  "pick.lon": "Lon",
  "pick.ellipsoid": "h (ellipsoid)",
  "pick.geoid": "N ({model})",
  "pick.approx": " ⚠ approx",
  "pick.empty": "Pick a point with any tool.",

  "meas.heading": "Measurements",
  "meas.csv": "CSV",
  "meas.empty": "Use Distance, Polyline or Area. Values are float64, shown to 0.1 mm.",
  "meas.savedTitle": "saved to project",
  "meas.zoomTo": "Zoom to",
  "meas.crossCheck": "Server cross-check",
  "meas.save": "Save to project",
  "meas.delete": "Delete",
  "meas.diff": "Browser vs Python: max difference {mm} mm",
  "meas.kind.point": "point",
  "meas.kind.distance": "distance",
  "meas.kind.polyline": "polyline",
  "meas.kind.area": "area",
  "meas.row.dist3d": "3D distance",
  "meas.row.horiz": "Horizontal",
  "meas.row.dx": "ΔX (north)",
  "meas.row.dy": "ΔY (east)",
  "meas.row.dh": "ΔH",
  "meas.row.grade": "Grade",
  "meas.row.angle": "Angle",
  "meas.row.len3d": "Length 3D",
  "meas.row.len2d": "Length 2D",
  "meas.row.vertices": "Vertices",
  "meas.row.planArea": "Plan area",
  "meas.row.perim2d": "Perimeter 2D",
  "meas.row.h": "H",

  "section.heading": "Cross-section",
  "section.empty": "Click the start and end of the section line in the 3D view.",
  "section.halfWidth": "Half width (m)",
  "section.clip.off": "No clip",
  "section.clip.highlight": "Highlight",
  "section.clip.slab": "Slab only",
  "section.loading": "Loading…",
  "section.refresh": "Refresh",
  "section.dxf": "Profile DXF",
  "section.clear": "Clear",

  "volume.heading": "Cut / fill volume",
  "volume.empty": "Click polygon vertices around the area, then press Enter or double-click.",
  "volume.refH": "Reference H (m)",
  "volume.method": "Method",
  "volume.method.grid": "Grid DEM",
  "volume.method.tin": "TIN (exact)",
  "volume.cell": "Cell (m)",
  "volume.computing": "Computing…",
  "volume.compute": "Compute",
  "volume.dem": "DEM GeoTIFF",
  "volume.cut": "Cut (above ref)",
  "volume.fill": "Fill (below ref)",
  "volume.net": "Net",
  "volume.area": "Plan area",
  "volume.points": "Points used",
  "volume.truth": "Analytic truth (synthetic site): stockpile {stockpile} m³ above 3.000 m (epoch A), pit {pit} m³ below 3.000 m.",

  "asbuilt.heading": "As-built (MLIT)",
  "asbuilt.checking": "Checking design surface…",
  "asbuilt.designLoaded": "Design ({kind}): {source} · {tris} tris",
  "asbuilt.kind.seeded": "seeded demo",
  "asbuilt.kind.uploaded": "uploaded",
  "asbuilt.noDesign": "No design surface for this project. Upload a DXF with 3DFACE entities.",
  "asbuilt.run": "Run as-built check",
  "asbuilt.download": "Download design TIN (DXF)",
  "asbuilt.uploading": "Uploading design DXF…",
  "asbuilt.upload": "+ Upload Design TIN (.dxf 3DFACE)",
  "asbuilt.tolerances": "MLIT tolerances: Flat ±50 / ±150 mm · Slope ±70 / ±160 mm · ≥1 pt/m² · ±5 cm crest/toe exclusion.",

  "proc.heading": "Processing",
  "proc.empty": "Show a dataset to process it.",
  "proc.clean": "Clean (SOR)",
  "proc.cleanTitle": "Statistical Outlier Removal (k = 16, nσ = 1)",
  "proc.asbuilt": "As-built check",
  "proc.asbuiltTitle": "Compare with the design surface using MLIT as-built tolerances",
  "proc.reference": "Reference",
  "proc.compared": "Compared",
  "proc.change": "Change detection (ΔZ)",

  "job.clean": "Cleaning",
  "job.asbuilt": "As-built",
  "job.change": "Change detection",
  "job.failed": "{task} failed: {detail}",
  "jobStatus.queued": "queued",
  "jobStatus.running": "running",
  "jobStatus.done": "done",
  "jobStatus.failed": "failed",

  "report.sor": "SOR removed {removed} points (threshold {threshold} m), kept {kept}.",
  "report.dzMinMax": "ΔZ min / max",
  "report.dzPct": "ΔZ p1 / p99",
  "report.rms": "RMS",
  "report.supported": "Supported",
  "report.pass": "PASS",
  "report.fail": "FAIL",
  "report.verdict": "{verdict} · As-built (MLIT)",
  "report.col.surface": "Surface",
  "report.col.pts": "pts",
  "report.col.mean": "mean",
  "report.col.tol": "> tol",
  "report.flat": "Flat",
  "report.slope": "Slope",
  "report.density": "Density ≥1 pt/m²",
  "report.cells": "{ok}/{total} cells",
  "report.breakline": "Crest/toe ±5 cm",
  "report.excluded": "{count} excluded",
  "report.legendNote": "Colour = deviation from design (±150 mm). Blue = below design (over-dig), red = above.",

  "exchange.heading": "Exchange (SIMA / DXF / LAS)",
  "exchange.showCp": "Show control points (CP)",
  "exchange.exportSima": "Export SIMA",
  "exchange.exportDxf": "Export DXF plan",
  "exchange.designDxf": "Design TIN DXF",
  "exchange.downloadLaz": "Download LAZ",
  "exchange.importSima": "+ Import SIMA (.sim, CP932)",
  "exchange.simaSummary": "{name}: {points} points, {parcels} parcels ({encoding}){warnings}",
  "exchange.simaWarnings": " · {count} warnings",

  "profile.title": "SEC-1",
  "profile.stats": "L = {length} m · {points} pts · H {zMin}–{zMax} m",
  "profile.ve": "VE",
  "profile.csvHeader": "station_m,elevation_m",
  "profile.readout": "STA {s} · H {z}",
  "profile.measure": "ΔSTA {dS} m · ΔH {dZ} m · grade {grade} %",

  "photo.heading": "Photos (RTK / EXIF) · 3DGS",
  "photo.showFrustums": "Show camera frustums ({count})",
  "photo.thumbTitle": "{filename} · yaw {yaw}° pitch {pitch}°",
  "photo.latLon": "Lat / Lon",
  "photo.ellipsoid": "h (ellipsoid)",
  "photo.xyh": "X / Y / H",
  "photo.yawPitch": "Yaw / Pitch",
  "photo.geoid": "Geoid",
  "photo.seeing": "Photos seeing the picked point:",
  "photo.seeingNone": "none",
  "photo.splat.show": "Show as 3D Gaussian Splats",
  "photo.splat.loading": "Loading 3DGS…",
  "photo.splat.hide": "Hide 3DGS layer",
  "photo.splat.pointsToo": "points too",
  "photo.splat.note": "{count} isotropic Gaussians (converted, not trained) · Spark renderer",
  "photo.splat.error": "3DGS: {detail}",
  "photo.overlay.hint": "camera at RTK pose · drag the slider to compare photo and point cloud",
  "photo.overlay.exit": "Exit photo view",
} as const;

export type I18nKey = keyof typeof en;

export const ja: Record<I18nKey, string> = {
  "app.title": "Simple-Point Lite — 3D点群測量",
  "app.startupFailed": "起動に失敗しました: {detail}。バックエンドAPIが稼働しているか確認してください。",
  "app.noProject": "利用可能なプロジェクトがありません。",

  "lang.aria": "言語切替",

  "toolbar.aria": "計測・解析ツール",
  "tool.navigate.label": "操作",
  "tool.navigate.hint": "左ドラッグで回転、右ドラッグで平行移動、ホイールで拡大縮小、ダブルクリックで注視",
  "tool.point.label": "座標",
  "tool.point.hint": "点をクリックして JGD2011 平面直角座標を取得",
  "tool.distance.label": "距離",
  "tool.distance.hint": "2点をクリック: 斜距離・水平距離・ΔX/ΔY/ΔH・勾配を計算",
  "tool.polyline.label": "折れ線",
  "tool.polyline.hint": "連続クリックで測線を作成、ダブルクリックまたは Enter で確定",
  "tool.area.label": "面積",
  "tool.area.hint": "頂点をクリック、ダブルクリックまたは Enter で確定（水平投影面積）",
  "tool.section.label": "断面",
  "tool.section.hint": "2点をクリックして縦横断図を作成",
  "tool.volume.label": "土量",
  "tool.volume.hint": "範囲の頂点をクリックし、Enter で切土・盛土量を計算",
  "tool.asbuilt.label": "出来形",
  "tool.asbuilt.hint": "右パネルで MLIT 出来形管理チェックや設計 TIN (DXF) の入出力を実行",

  "project.heading": "プロジェクト",

  "layers.heading": "レイヤー",
  "layers.seeding": "デモデータセットを準備中…",
  "layers.points": "{count} M 点",
  "layers.status.processing": "処理中",
  "layers.status.failed": "失敗",
  "layers.deleteTitle": "この派生データセットを削除",
  "layers.upload": "+ 点群アップロード (LAS/LAZ/E57/PLY/PTS/XYZ)",
  "layers.ingestFailed": "取り込み失敗: {detail}",

  "offline.heading": "オフライン（ローカル・WASM）",
  "offline.open": "+ ローカル LAS/LAZ を開く（送信なし）",
  "offline.localTag": "{count} M 点 · ローカル",
  "offline.closeTitle": "閉じる",
  "offline.reading": "{name} を読み込み中…",
  "offline.decoding": "デコード中 (WASM)",
  "offline.buildingOctree": "八分木を構築中",
  "offline.failed": "読み込み失敗: {detail}",
  "offline.opened": "{name} を開きました: {points} 点（{sec} 秒・サーバー送信なし）",

  "color.heading": "表示色",
  "color.rgb": "RGB",
  "color.elevation": "標高",
  "color.intensity": "反射強度",
  "color.classification": "分類",
  "color.change": "変化量 ΔZ",
  "color.minH": "最小標高",
  "color.maxH": "最大標高",
  "color.range": "±表示幅",
  "color.lower": "−{mm} mm（低下）",
  "color.higher": "+{mm} mm（上昇）",
  "color.noDz": "右パネルの「差分検出 (ΔZ)」を実行すると ΔZ を表示できます。",

  "render.heading": "描画設定",
  "render.pointBudget": "最大表示点数",
  "render.pointSize": "点サイズ",
  "render.adaptive": "適応サイズ（LOD間隔）",
  "render.edl": "EDL 陰影強調",
  "render.resetView": "視点リセット",

  "hud.aria": "描画統計",
  "hud.fps": "FPS",
  "hud.pts": "{vis} M / {bud} M 点",
  "hud.nodes": "{nodes} ノード · {pending} 読込中",
  "hud.gpu": "GPU ≈ {mb} MB",

  "status.coords": "X {x} · Y {y} · H {h} m",
  "status.dz": " · ΔZ {mm} mm",
  "status.idle": "点群上にカーソルを合わせると JGD2011 平面直角座標（X = 北, Y = 東）を表示します",
  "status.dismiss": "閉じる",

  "pick.heading": "最後に取得した点",
  "pick.xNorth": "X（北方向）",
  "pick.yEast": "Y（東方向）",
  "pick.h": "標高 H",
  "pick.lat": "緯度",
  "pick.lon": "経度",
  "pick.ellipsoid": "楕円体高 h",
  "pick.geoid": "ジオイド高 N ({model})",
  "pick.approx": " ⚠ 近似値",
  "pick.empty": "計測ツールで任意の点をクリックしてください。",

  "meas.heading": "計測一覧",
  "meas.csv": "CSV",
  "meas.empty": "距離・折れ線・面積ツールで計測します。float64（0.1 mm 単位）で表示されます。",
  "meas.savedTitle": "プロジェクトに保存済み",
  "meas.zoomTo": "ズーム",
  "meas.crossCheck": "サーバー検算",
  "meas.save": "保存",
  "meas.delete": "削除",
  "meas.diff": "ブラウザ vs Python検算: 最大差 {mm} mm",
  "meas.kind.point": "座標",
  "meas.kind.distance": "距離",
  "meas.kind.polyline": "折れ線",
  "meas.kind.area": "面積",
  "meas.row.dist3d": "斜距離 (3D)",
  "meas.row.horiz": "水平距離",
  "meas.row.dx": "ΔX（北）",
  "meas.row.dy": "ΔY（東）",
  "meas.row.dh": "比高 ΔH",
  "meas.row.grade": "勾配",
  "meas.row.angle": "傾斜角",
  "meas.row.len3d": "延長 (3D)",
  "meas.row.len2d": "水平延長 (2D)",
  "meas.row.vertices": "頂点数",
  "meas.row.planArea": "水平面積",
  "meas.row.perim2d": "周囲長 (2D)",
  "meas.row.h": "標高 H",

  "section.heading": "断面図",
  "section.empty": "3Dビュー上で断面線の始点と終点をクリックしてください。",
  "section.halfWidth": "断面半幅 (m)",
  "section.clip.off": "クリップなし",
  "section.clip.highlight": "強調表示",
  "section.clip.slab": "断面帯のみ",
  "section.loading": "読込中…",
  "section.refresh": "再読込",
  "section.dxf": "断面図 DXF",
  "section.clear": "クリア",

  "volume.heading": "切土・盛土量",
  "volume.empty": "対象範囲の頂点をクリックし、Enter またはダブルクリックで確定してください。",
  "volume.refH": "基準高 H (m)",
  "volume.method": "計算方式",
  "volume.method.grid": "格子 DEM",
  "volume.method.tin": "TIN（厳密）",
  "volume.cell": "格子幅 (m)",
  "volume.computing": "計算中…",
  "volume.compute": "計算実行",
  "volume.dem": "DEM GeoTIFF",
  "volume.cut": "切土（基準高以上）",
  "volume.fill": "盛土（基準高以下）",
  "volume.net": "差引（切土−盛土）",
  "volume.area": "水平投影面積",
  "volume.points": "使用点数",
  "volume.truth": "解析理論値（合成サイト）: 土砂堆積 {stockpile} m³（3.000 m 以上・エポック A）、掘削ピット {pit} m³（3.000 m 以下）。",

  "asbuilt.heading": "出来形 (MLIT 面管理)",
  "asbuilt.checking": "設計面を確認中…",
  "asbuilt.designLoaded": "設計面（{kind}）: {source} · {tris} 三角形",
  "asbuilt.kind.seeded": "サンプル",
  "asbuilt.kind.uploaded": "アップロード",
  "asbuilt.noDesign": "設計面がありません。3DFACE を含む DXF をアップロードしてください。",
  "asbuilt.run": "出来形チェックを実行",
  "asbuilt.download": "設計 TIN をダウンロード (DXF)",
  "asbuilt.uploading": "設計 DXF をアップロード中…",
  "asbuilt.upload": "+ 設計 TIN をアップロード (.dxf 3DFACE)",
  "asbuilt.tolerances": "MLIT 規格値: 平場 ±50 / ±150 mm · 法面 ±70 / ±160 mm · 密度 ≥1 点/m² · 法肩/法尻 ±5 cm 除外。",

  "proc.heading": "点群解析・処理",
  "proc.empty": "処理対象のデータセットを表示してください。",
  "proc.clean": "ノイズ除去 (SOR)",
  "proc.cleanTitle": "統計的外れ値除去 (k = 16, nσ = 1)",
  "proc.asbuilt": "出来形チェック",
  "proc.asbuiltTitle": "MLIT 出来形管理基準で設計面と比較します",
  "proc.reference": "基準データ",
  "proc.compared": "比較データ",
  "proc.change": "差分検出 (ΔZ)",

  "job.clean": "ノイズ除去",
  "job.asbuilt": "出来形チェック",
  "job.change": "差分検出",
  "job.failed": "{task}に失敗しました: {detail}",
  "jobStatus.queued": "待機中",
  "jobStatus.running": "実行中",
  "jobStatus.done": "完了",
  "jobStatus.failed": "失敗",

  "report.sor": "SOR により {removed} 点を除去（しきい値 {threshold} m）、{kept} 点を保持しました。",
  "report.dzMinMax": "ΔZ 最小 / 最大",
  "report.dzPct": "ΔZ p1 / p99",
  "report.rms": "RMS",
  "report.supported": "対応点数",
  "report.pass": "合格",
  "report.fail": "不合格",
  "report.verdict": "{verdict} · 出来形 (MLIT 面管理)",
  "report.col.surface": "面種別",
  "report.col.pts": "点数",
  "report.col.mean": "平均",
  "report.col.tol": "規格外",
  "report.flat": "平場",
  "report.slope": "法面",
  "report.density": "点密度 ≥1 点/m²",
  "report.cells": "{ok}/{total} メッシュ",
  "report.breakline": "法肩/法尻 ±5 cm",
  "report.excluded": "{count} 点除外",
  "report.legendNote": "表示色 = 設計面との偏差（±150 mm）。青 = 設計より低い（過掘）、赤 = 高い。",

  "exchange.heading": "データ交換 (SIMA / DXF / LAS)",
  "exchange.showCp": "基準点を表示",
  "exchange.exportSima": "SIMA 出力",
  "exchange.exportDxf": "平面図 DXF 出力",
  "exchange.designDxf": "設計 TIN DXF",
  "exchange.downloadLaz": "LAZ ダウンロード",
  "exchange.importSima": "+ SIMA インポート (.sim, CP932)",
  "exchange.simaSummary": "{name}: {points} 点, {parcels} 区画 ({encoding}){warnings}",
  "exchange.simaWarnings": " · 警告 {count} 件",

  "profile.title": "断面1",
  "profile.stats": "延長 L = {length} m · {points} 点 · 標高 H {zMin}–{zMax} m",
  "profile.ve": "縦倍率",
  "profile.csvHeader": "距離程_m,標高_m",
  "profile.readout": "距離程 {s} · 標高 {z}",
  "profile.measure": "Δ距離 {dS} m · ΔH {dZ} m · 勾配 {grade} %",

  "photo.heading": "写真 (RTK / EXIF) · 3DGS",
  "photo.showFrustums": "カメラ画角を表示 ({count})",
  "photo.thumbTitle": "{filename} · ヨー {yaw}° ピッチ {pitch}°",
  "photo.latLon": "緯度 / 経度",
  "photo.ellipsoid": "楕円体高 h",
  "photo.xyh": "X / Y / 標高 H",
  "photo.yawPitch": "ヨー / ピッチ",
  "photo.geoid": "ジオイド",
  "photo.seeing": "選択点を写している写真:",
  "photo.seeingNone": "該当なし",
  "photo.splat.show": "3D Gaussian Splats で表示",
  "photo.splat.loading": "3DGS を読込中…",
  "photo.splat.hide": "3DGS レイヤーを非表示",
  "photo.splat.pointsToo": "点群も表示",
  "photo.splat.note": "{count} 等方性ガウシアン（点群変換・未学習）· Spark レンダラ",
  "photo.splat.error": "3DGS: {detail}",
  "photo.overlay.hint": "RTK 位置姿勢で同期中 · スライダーで写真と点群を比較",
  "photo.overlay.exit": "写真ビューを終了",
};

export function t(lang: Lang, key: I18nKey, params?: Record<string, string | number>): string {
  const template = (lang === "ja" ? ja : en)[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function formatControlPointName(number: number, fallback: string, lang: Lang): string {
  if (lang === "en") return `CP-${number}`;
  return fallback || `基準点${number}`;
}

export function formatProjectName(name: string, lang: Lang): string {
  if (lang === "ja") {
    if (name === "Toyosu Construction Site (synthetic)") return "豊洲建設現場（合成デモ）";
    if (name === "Other tenant's private project") return "他テナントの非公開プロジェクト";
  } else {
    if (name === "豊洲建設現場（合成デモ）") return "Toyosu Construction Site (synthetic)";
    if (name === "他テナントの非公開プロジェクト") return "Other tenant's private project";
  }
  return name;
}

function formatDatasetNameInner(raw: string, lang: Lang): string {
  if (raw.startsWith("As-built deviation: ") || raw.startsWith("出来形偏差: ")) {
    const inner = raw.startsWith("As-built deviation: ")
      ? raw.slice("As-built deviation: ".length)
      : raw.slice("出来形偏差: ".length);
    const formattedInner = formatDatasetNameInner(inner, lang);
    return lang === "ja" ? `出来形偏差: ${formattedInner}` : `As-built deviation: ${formattedInner}`;
  }

  if (raw.endsWith(" (cleaned)") || raw.endsWith("（ノイズ除去）")) {
    const base = raw.endsWith(" (cleaned)")
      ? raw.slice(0, -" (cleaned)".length)
      : raw.slice(0, -"（ノイズ除去）".length);
    const formattedBase = formatDatasetNameInner(base, lang);
    return lang === "ja" ? `${formattedBase}（ノイズ除去）` : `${formattedBase} (cleaned)`;
  }

  const changeMatch = raw.match(/^ΔZ (.+?) (?:vs|対) (.+)$/);
  if (changeMatch) {
    const bSide = formatDatasetNameInner(changeMatch[1]!, lang);
    const aSide = formatDatasetNameInner(changeMatch[2]!, lang);
    return lang === "ja" ? `ΔZ ${bSide} 対 ${aSide}` : `ΔZ ${bSide} vs ${aSide}`;
  }

  const epochMatch = raw.match(/^(?:Epoch\s+|エポック)([A-Za-z0-9]+):\s*(.+?)\s*(?:TLS scan|TLSスキャン)$/);
  if (epochMatch) {
    const ep = epochMatch[1]!;
    const date = epochMatch[2]!;
    return lang === "ja" ? `エポック${ep}: ${date} TLSスキャン` : `Epoch ${ep}: ${date} TLS scan`;
  }

  return raw;
}

export function formatDatasetName(
  ds: { name: string; epoch?: string | null; sourceFormat?: string; meta?: Record<string, any> },
  lang: Lang,
): string {
  return formatDatasetNameInner(ds.name, lang);
}

export function formatDesignSource(
  source: string,
  lang: Lang,
  sourceKey?: string,
): { label: string; isSeeded: boolean } {
  const isSeeded = sourceKey === "synthetic_design" || source.startsWith("synthetic design");
  if (isSeeded) {
    return {
      isSeeded: true,
      label: lang === "ja" ? "合成設計データ（平坦部＋1:0.5掘削法面）" : source || "synthetic design (pad + 1:0.5 pit)",
    };
  }
  return { isSeeded: false, label: source };
}

type ErrorFormatter = (params: Record<string, unknown>, rawDetail?: string) => string;

const ERROR_MESSAGES: Record<string, { en: ErrorFormatter; ja: ErrorFormatter }> = {
  AUTH_INVALID_TOKEN: {
    en: () => "Invalid or missing authentication token.",
    ja: () => "認証トークンが無効または不足しています。",
  },
  PROJECT_NOT_FOUND: {
    en: () => "Project not found.",
    ja: () => "プロジェクトが見つかりません。",
  },
  ROLE_REQUIRED: {
    en: (p) => `Requires ${String(p.role ?? "higher")} role.`,
    ja: (p) => {
      const role = String(p.role ?? "");
      const jaRole = role === "owner" ? "オーナー" : role === "editor" ? "編集者" : role === "viewer" ? "閲覧者" : role;
      return `${jaRole || "上位"} 権限が必要です。`;
    },
  },
  DATASET_NOT_FOUND: {
    en: () => "Dataset not found.",
    ja: () => "データセットが見つかりません。",
  },
  JOB_NOT_FOUND: {
    en: () => "Job not found.",
    ja: () => "ジョブが見つかりません。",
  },
  HIERARCHY_NOT_FOUND: {
    en: () => "Octree hierarchy not found.",
    ja: () => "八分木階層ファイルが見つかりません。",
  },
  NODE_NOT_FOUND: {
    en: () => "Octree node not found.",
    ja: () => "八分木ノードが見つかりません。",
  },
  POINT_CLOUD_TOO_SMALL: {
    en: () => "Point cloud has too few points for this operation.",
    ja: () => "点群の点数が少なすぎるため処理できません。",
  },
  UNSUPPORTED_FORMAT: {
    en: (p, raw) =>
      p.suffix !== undefined
        ? `Unsupported file type ${String(p.suffix)}${p.supported ? `; supported: ${String(p.supported)}` : ""}.`
        : raw || "Unsupported file format.",
    ja: (p) =>
      p.suffix !== undefined
        ? `未対応のファイル形式です（${String(p.suffix)}）${p.supported ? `。対応形式: ${String(p.supported)}` : ""}。`
        : "未対応のファイル形式です。",
  },
  UPLOAD_INVALID_CLOUD: {
    en: (p, raw) => (p.detail ? `Invalid point cloud file: ${String(p.detail)}` : raw || "Invalid point cloud file."),
    ja: (p, raw) => {
      const d = p.detail ?? raw;
      return d ? `点群ファイルを読み込めません: ${String(d)}` : "点群ファイルを読み込めません。";
    },
  },
  DATASET_NOT_READY: {
    en: (p) => `Dataset is ${String(p.status ?? "not ready")}.`,
    ja: (p) => {
      const st = String(p.status ?? "");
      const jaStatus = st === "processing" ? "処理中" : st === "failed" ? "失敗" : st || "未準備";
      return `データセットは現在「${jaStatus}」のため実行できません。`;
    },
  },
  CANNOT_DELETE_BASE_DATASET: {
    en: () => "Dataset has derived datasets; delete those first.",
    ja: () => "派生データセットが存在するため削除できません。先に派生データを削除してください。",
  },
  POINT_EXCEEDS_MAX: {
    en: (p, raw) => (p.max !== undefined ? `Point count exceeds maximum (${String(p.max)}).` : raw || "Point count exceeds maximum."),
    ja: (p) => (p.max !== undefined ? `点数が上限（${String(p.max)}）を超えています。` : "点数が上限を超えています。"),
  },
  TOO_FEW_POINTS_IN_POLYGON: {
    en: () => "Fewer than 3 points inside the polygon.",
    ja: () => "ポリゴン内の点数が 3 点未満です。",
  },
  DATASETS_DIFFERENT_PROJECTS: {
    en: () => "Datasets belong to different projects.",
    ja: () => "異なるプロジェクトのデータセットは比較できません。",
  },
  NO_DESIGN_SURFACE: {
    en: () => "No design surface for this project; upload a DXF with 3DFACE entities.",
    ja: () => "このプロジェクトには設計面がありません。3DFACE を含む DXF をアップロードしてください。",
  },
  INVALID_DESIGN_DXF: {
    en: (p, raw) => (p.detail ? `Cannot read design DXF: ${String(p.detail)}` : raw || "Cannot read design DXF."),
    ja: (p, raw) => {
      const d = p.detail ?? raw;
      return d ? `設計 DXF を読み込めません: ${String(d)}` : "設計 DXF を読み込めません。";
    },
  },
  MISSING_DESIGN_SURFACE: {
    en: () => "No design surface found.",
    ja: () => "設計面が見つかりません。",
  },
  SIMA_NO_RECORDS: {
    en: () => "No A01 coordinate records found in SIMA file.",
    ja: () => "SIMA ファイルに A01 座標レコードが見つかりません。",
  },
  PHOTO_NO_GPS: {
    en: (p, raw) => (p.detail ? `Cannot read photo position: ${String(p.detail)}` : raw || "Cannot read photo EXIF/RTK position."),
    ja: (p, raw) => {
      const d = p.detail ?? raw;
      return d ? `写真の EXIF/RTK 位置情報を読み取れません: ${String(d)}` : "写真の EXIF/RTK 位置情報を読み取れません。";
    },
  },
  PHOTO_NOT_FOUND: {
    en: () => "Photo not found.",
    ja: () => "写真が見つかりません。",
  },
  INVALID_VALUE: {
    en: (p, raw) => (p.detail ? `Invalid value: ${String(p.detail)}` : raw || "Invalid input value."),
    ja: (p, raw) => {
      const d = p.detail ?? raw;
      return d ? `入力値が不正です: ${String(d)}` : "入力値が不正です。";
    },
  },
  CRS_OUTSIDE_GEOID: {
    en: (p, raw) => (p.detail ? String(p.detail) : raw || "Coordinates are outside geoid model coverage."),
    ja: () => "座標がジオイドモデルの適用範囲外です。",
  },
  // Offline worker & 3D engine codes
  TOO_MANY_RESIDENT_NODES: {
    en: () => "Too many resident octree nodes in memory.",
    ja: () => "メモリ上の常駐八分木ノード数が上限を超えました。",
  },
  NODE_BYTE_SIZE: {
    en: (p, raw) =>
      p.actual !== undefined && p.expected !== undefined
        ? `Node size ${String(p.actual)} B does not match expected ${String(p.expected)} B${p.count !== undefined ? ` for ${String(p.count)} points` : ""}.`
        : raw || "Unexpected octree node byte size.",
    ja: (p) =>
      p.actual !== undefined && p.expected !== undefined
        ? `ノードサイズが不正です（${String(p.actual)} B / 期待値 ${String(p.expected)} B${p.count !== undefined ? `・${String(p.count)} 点` : ""}）。`
        : "ノードサイズが不正です。",
  },
  NODE_SIZE_MISMATCH: {
    en: (p, raw) => raw || `Node size ${String(p.actual ?? "")} B does not match expected ${String(p.expected ?? "")} B.`,
    ja: (p) =>
      p.actual !== undefined && p.expected !== undefined
        ? `ノードサイズが不正です（${String(p.actual)} B / 期待値 ${String(p.expected)} B）。`
        : "ノードサイズが不正です。",
  },
  NOT_LAS_FILE: {
    en: () => "Not a valid LAS/LAZ file.",
    ja: () => "有効な LAS/LAZ ファイルではありません。",
  },
  LAZ_WASM_REQUIRED: {
    en: () => "LAZ decompression requires the laz-perf WASM module.",
    ja: () => "LAZ の展開には laz-perf WASM モジュールが必要です。",
  },
  EMPTY_POINT_CLOUD: {
    en: () => "The point cloud contains no points.",
    ja: () => "点群に点が 1 つも含まれていません。",
  },
  MISSING_NODE: {
    en: (p) => `Missing octree node ${String(p.name ?? "")}.`.trim(),
    ja: (p) => (p.name ? `八分木ノード ${String(p.name)} が見つかりません。` : "八分木ノードが見つかりません。"),
  },
  NO_PROJECT_AVAILABLE: {
    en: () => "No project available.",
    ja: () => "利用可能なプロジェクトがありません。",
  },
};

function normalizeErrorCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  return trimmed.startsWith("ERR_") ? trimmed.slice(4) : trimmed;
}

function matchRawMessage(msg: string, lang: Lang): string | null {
  const prefixed = msg.match(/^(ERR_[A-Z0-9_]+)\s*:\s*(.*)$/);
  if (prefixed) {
    const entry = ERROR_MESSAGES[normalizeErrorCode(prefixed[1]!)];
    if (entry) return entry[lang]({}, prefixed[2] || msg);
  }
  if (/^too many resident nodes$/i.test(msg)) return ERROR_MESSAGES.TOO_MANY_RESIDENT_NODES![lang]({}, msg);
  if (/^not a LAS\/LAZ file$/i.test(msg)) return ERROR_MESSAGES.NOT_LAS_FILE![lang]({}, msg);
  if (/^LAZ needs the laz-perf WASM module$/i.test(msg)) return ERROR_MESSAGES.LAZ_WASM_REQUIRED![lang]({}, msg);
  if (/^empty point cloud$/i.test(msg)) return ERROR_MESSAGES.EMPTY_POINT_CLOUD![lang]({}, msg);
  if (/^no project available$/i.test(msg)) return ERROR_MESSAGES.NO_PROJECT_AVAILABLE![lang]({}, msg);

  const missingNode = msg.match(/^missing node (.+)$/i);
  if (missingNode) return ERROR_MESSAGES.MISSING_NODE![lang]({ name: missingNode[1] }, msg);

  const nodeSize = msg.match(/^node size (\d+) B, expected (\d+) B for (\d+) points$/i);
  if (nodeSize) return ERROR_MESSAGES.NODE_BYTE_SIZE![lang]({ actual: nodeSize[1], expected: nodeSize[2], count: nodeSize[3] }, msg);

  return null;
}

export function localizeError(err: unknown, lang: Lang): string {
  if (err && typeof err === "object") {
    const obj = err as { code?: unknown; params?: unknown; message?: unknown };
    const rawMsg = err instanceof Error ? err.message : typeof obj.message === "string" ? obj.message : undefined;
    if (typeof obj.code === "string" && obj.code.trim()) {
      const normalized = normalizeErrorCode(obj.code);
      const entry = ERROR_MESSAGES[normalized];
      const params = obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : {};
      if (entry) return entry[lang](params, rawMsg);
    }
    if (rawMsg) {
      const matched = matchRawMessage(rawMsg, lang);
      if (matched) return matched;
      return rawMsg;
    }
  }
  if (typeof err === "string") {
    const normalized = normalizeErrorCode(err);
    const entry = ERROR_MESSAGES[normalized];
    if (entry) return entry[lang]({}, err);
    const matched = matchRawMessage(err, lang);
    if (matched) return matched;
    return err;
  }
  return String(err);
}
