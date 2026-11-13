import { useEffect } from "react";
import { api } from "./api/client";
import { localizeError, t } from "./i18n";
import { syncDocumentLang, useStore } from "./store";
import { AnalysisPanel, ProfileDrawer } from "./ui/AnalysisPanel";
import { Hud, LayerPanel, MeasurementPanel, StatusBar, Toolbar } from "./ui/panels";
import { PhotoOverlay, PhotoPanel } from "./ui/PhotoPanel";
import { Viewer } from "./ui/Viewer";

export default function App() {
  const set = useStore((s) => s.set);
  const lang = useStore((s) => s.lang);

  useEffect(() => {
    syncDocumentLang(lang);
  }, [lang]);

  useEffect(() => {
    (async () => {
      const user = await api.login();
      const [project] = await api.projects();
      if (!project) throw new Error("no project available");
      // the seed ingests in the background on first start: wait until datasets are ready
      for (;;) {
        const datasets = await api.datasets(project.id);
        const first = datasets.find((d) => d.status === "ready");
        set({ user, project, datasets, visible: first ? { [first.id]: true } : {} });
        if (datasets.length && datasets.every((d) => d.status !== "processing")) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const saved = await api.listMeasurements(project.id);
      set({
        measurements: saved.map((m) => ({ id: m.id, kind: m.kind, label: m.label, points: m.points, savedId: m.id })),
      });
    })().catch((err) => {
      const curLang = useStore.getState().lang;
      set({ error: t(curLang, "app.startupFailed", { detail: localizeError(err, curLang) }) });
    });
  }, [set]);

  return (
    <div className="app">
      <Toolbar />
      <LayerPanel />
      <main className="stage">
        <Viewer />
        <PhotoOverlay />
        <Hud />
        <ProfileDrawer />
      </main>
      <aside className="panel right">
        <MeasurementPanel />
        <AnalysisPanel />
        <PhotoPanel />
      </aside>
      <StatusBar />
    </div>
  );
}
