import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { rotationRows, verticalFov } from "../geo/camera";
import { useStore } from "../store";
import { activeDataset } from "./analysisTools";
import { getEngine } from "./engineRef";
import { usePhotos, type Photo, type Seeing } from "./photoStore";

const img = (id: string) => `/api/photos/${id}.jpg?token=${encodeURIComponent(api.token)}`;

export function openPhoto(p: Photo, marker?: { u: number; v: number }) {
  getEngine()?.enterPhotoView(p.center as [number, number, number], rotationRows(p.pose), verticalFov(p.pose));
  usePhotos.getState().set({ active: { id: p.id, marker } });
}

export function closePhoto() {
  getEngine()?.exitPhotoView();
  usePhotos.getState().set({ active: null });
}

export function PhotoPanel() {
  const project = useStore((s) => s.project);
  const lastPick = useStore((s) => s.lastPick);
  const { photos, showFrustums, active, seeing, splat, set } = usePhotos(
    useShallow((s) => ({ photos: s.photos, showFrustums: s.showFrustums, active: s.active, seeing: s.seeing, splat: s.splat, set: s.set })),
  );

  useEffect(() => {
    if (!project) return;
    let stop = false;
    const load = async () => {
      // photos are rendered by a background job on first start: poll until the batch count stabilizes
      let prevLen = -1;
      for (let i = 0; i < 60 && !stop; i++) {
        const list = await api.get<Photo[]>(`/projects/${project.id}/photos`).catch(() => []);
        if (stop) return;
        if (list.length > 0) {
          if (list.length === prevLen) return;
          prevLen = list.length;
          usePhotos.getState().set({ photos: list });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, [project]);

  useEffect(() => {
    if (!project || !lastPick) return;
    api.post<Seeing[]>(`/projects/${project.id}/photos/see`, { point: lastPick.position })
      .then((s) => usePhotos.getState().set({ seeing: s }))
      .catch(() => undefined);
  }, [project, lastPick]);

  const toggleSplat = async () => {
    const e = getEngine();
    const ds = activeDataset();
    const o = e?.getOrigin();
    if (!e || !ds || !o) return;
    if (splat.status === "on") {
      e.splats.dispose();
      set({ splat: { ...splat, status: "off", count: 0 } });
      return;
    }
    set({ splat: { ...splat, status: "loading" } });
    try {
      const n = 400_000;
      const bytes = await api.get<ArrayBuffer>(`/datasets/${ds.id}/splat.ply?ox=${o[0]}&oy=${o[1]}&oz=${o[2]}&maxPoints=${n}`);
      await e.splats.load(bytes, Math.min(n, ds.pointCount));
      set({ splat: { ...splat, status: "on", count: Math.min(n, ds.pointCount) } });
    } catch (err) {
      useStore.getState().set({ error: `3DGS: ${String(err)}` });
      set({ splat: { ...splat, status: "off" } });
    }
  };

  return (
    <section>
      <h3>Photos (RTK / EXIF) · 3DGS</h3>
      <label className="row check">
        <input type="checkbox" checked={showFrustums} onChange={(e) => set({ showFrustums: e.target.checked })} /> Show camera frustums ({photos.length})
      </label>
      <div className="thumbs">
        {photos.map((p) => (
          <button key={p.id} className={`thumb ${active?.id === p.id ? "sel" : ""}`} onClick={() => openPhoto(p)} title={`${p.filename} · yaw ${p.pose.yaw.toFixed(1)}° pitch ${p.pose.pitch.toFixed(1)}°`}>
            <img src={img(p.id)} alt={p.filename} loading="lazy" />
            <span>{p.filename.replace(".JPG", "")}</span>
          </button>
        ))}
      </div>
      {active && (() => {
        const p = photos.find((x) => x.id === active.id);
        if (!p) return null;
        return (
          <table className="kv mono" style={{ marginTop: 6 }}>
            <tbody>
              <tr><td>Lat / Lon</td><td>{p.pose.lat.toFixed(7)}, {p.pose.lon.toFixed(7)}</td></tr>
              <tr><td>h (ellipsoid)</td><td>{p.pose.h.toFixed(3)} m</td></tr>
              <tr><td>X / Y / H</td><td>{p.center[1].toFixed(3)} / {p.center[0].toFixed(3)} / {p.center[2].toFixed(3)}</td></tr>
              <tr><td>Yaw / Pitch</td><td>{p.pose.yaw.toFixed(2)}° / {p.pose.pitch.toFixed(2)}°</td></tr>
              <tr><td>Geoid</td><td>{p.pose.geoid_model}</td></tr>
            </tbody>
          </table>
        );
      })()}
      {lastPick && (
        <div className="small" style={{ marginTop: 6 }}>
          <b>Photos seeing the picked point:</b> {seeing.length === 0 && <span className="muted">none</span>}
          {seeing.map((s) => (
            <button key={s.id} className="ghost small" style={{ margin: 2 }} onClick={() => { const p = photos.find((x) => x.id === s.id); if (p) openPhoto(p, { u: s.u, v: s.v }); }}>
              {s.filename.replace(".JPG", "")} ({s.distance.toFixed(0)} m)
            </button>
          ))}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="ghost small" disabled={splat.status === "loading" || !activeDataset()} onClick={toggleSplat}>
          {splat.status === "on" ? "Hide 3DGS layer" : splat.status === "loading" ? "Loading 3DGS…" : "Show as 3D Gaussian Splats"}
        </button>
        {splat.status === "on" && (
          <label className="row check small">
            <input type="checkbox" checked={splat.showPoints} onChange={(e) => {
              set({ splat: { ...splat, showPoints: e.target.checked } });
              const st = useStore.getState();
              const ds = activeDataset();
              if (ds) st.set({ visible: { ...st.visible, [ds.id]: e.target.checked } });
            }} /> points too
          </label>
        )}
      </div>
      {splat.status === "on" && <div className="small muted">{splat.count.toLocaleString()} isotropic Gaussians (converted, not trained) · Spark renderer</div>}
    </section>
  );
}

/** Photo image over the 3D view; the camera is at the photo pose so the two line up. */
export function PhotoOverlay() {
  const { active, photos, opacity, set } = usePhotos(useShallow((s) => ({ active: s.active, photos: s.photos, opacity: s.opacity, set: s.set })));
  const p = active ? photos.find((x) => x.id === active.id) : null;
  if (!p) return null;
  const aspect = p.pose.width / p.pose.height;
  return (
    <div className="photo-overlay">
      <div className="photo-frame" style={{ aspectRatio: String(aspect) }}>
        <img src={img(p.id)} alt={p.filename} style={{ opacity }} />
        {active?.marker && (
          <div className="photo-marker" style={{ left: `${(active.marker.u / p.pose.width) * 100}%`, top: `${(active.marker.v / p.pose.height) * 100}%` }} />
        )}
      </div>
      <div className="photo-bar">
        <b>{p.filename}</b>
        <span className="small muted">camera at RTK pose · drag the slider to compare photo and point cloud</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
        <button className="ghost small" onClick={closePhoto}>Exit photo view</button>
      </div>
    </div>
  );
}
