"""Capture README screenshots by driving the running app (dev server) with real mouse input.

Needs: backend on :8000 and `npm run dev` on :5173 (dev build exposes window.__spl for scripting),
`pip install playwright` and an installed Google Chrome (no browser download needed).

    backend/.venv/Scripts/python scripts/screenshots.py
"""
from __future__ import annotations

import pathlib
import time

from playwright.sync_api import Page, sync_playwright

URL = "http://localhost:5173"
OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "screenshots"
E0, N0 = -4300.0, -39000.0  # synthetic site local origin (Zone IX, Toyosu)


def L(x: float, y: float, z: float) -> list[float]:
    return [E0 + x, N0 + y, z]


def wait(page: Page, js: str, timeout: float = 180) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js):
            return
        page.wait_for_timeout(500)
    raise TimeoutError(js)


def settle(page: Page, ms: int = 2500) -> None:
    """Let LOD streaming finish (HUD pending == 0) and damping settle."""
    page.wait_for_timeout(600)
    wait(page, "() => { const s = window.__spl.store.getState().stats; return s && s.pending === 0; }", 60)
    page.wait_for_timeout(ms)


def look(page: Page, target: list[float], dist: float) -> None:
    page.evaluate("([t, d]) => window.__spl.engine.lookAt(t, d)", [target, dist])
    settle(page)


def click_world(page: Page, p: list[float]) -> None:
    xy = page.evaluate(
        """(p) => { const e = window.__spl.engine; const s = e.project(p); const r = e.renderer.domElement.getBoundingClientRect();
                   return [r.left + s.x, r.top + s.y]; }""", p)
    page.mouse.click(xy[0], xy[1])
    page.wait_for_timeout(250)


def button(page: Page, text: str) -> None:
    page.get_by_role("button", name=text, exact=True).first.click()


def run_job(page: Page, text: str) -> None:
    button(page, text)
    page.wait_for_timeout(1500)
    wait(page, "() => Object.keys(window.__spl.analysis.getState().busy).length === 0", 300)
    page.wait_for_timeout(1000)


def show_only(page: Page, predicate_js: str) -> None:
    page.evaluate(f"""() => {{ const s = window.__spl.store.getState();
        const d = s.datasets.filter({predicate_js}).at(-1); s.set({{ visible: {{ [d.id]: true }} }}); }}""")
    page.wait_for_timeout(800)


def shot(page: Page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / name), type="jpeg", quality=85)
    print("saved", name)


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
        page.goto(URL)
        wait(page, "() => window.__spl && window.__spl.store.getState().datasets.length >= 2 && window.__spl.store.getState().datasets.every(d => d.status === 'ready')")
        wait(page, "() => document.querySelectorAll('.thumb').length >= 12")
        page.evaluate("() => window.__spl.store.getState().set({ pointBudget: 3000000 })")
        settle(page, 3000)
        shot(page, "01-overview.jpg")

        page.evaluate("() => window.__spl.store.getState().set({ colorMode: 'elevation' })")
        settle(page, 1500)
        shot(page, "02-elevation.jpg")

        # distance on the 5 % ramp
        page.evaluate("() => window.__spl.store.getState().set({ colorMode: 'rgb' })")
        look(page, L(145, 45, 4.25), 55)
        button(page, "Distance")
        click_world(page, L(130, 45, 3.5))
        click_world(page, L(160, 45, 5.0))
        settle(page, 1000)
        shot(page, "03-measure-ramp.jpg")

        # cross-section through the pit
        button(page, "Navigate")
        look(page, L(40, 35, 2), 45)
        button(page, "Section")
        click_world(page, L(25, 35, 3))
        click_world(page, L(55, 35, 3))
        wait(page, "() => !!document.querySelector('.profile-drawer')")
        settle(page, 1500)
        shot(page, "04-section-profile.jpg")
        page.evaluate("() => { window.__spl.analysis.getState().set({ section: null, profile: null }); window.__spl.engine.setClip(null); }")

        # cleaning + volume of the stockpile (TIN on the cleaned scan)
        button(page, "Navigate")
        run_job(page, "Clean (SOR)")
        look(page, L(85, 60, 5), 45)
        button(page, "Volume")
        import math
        for k in range(10):
            t = 2 * math.pi * k / 10
            click_world(page, L(85 + 10.5 * math.cos(t), 60 + 10.5 * math.sin(t), 3))
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        page.locator(".field", has_text="Reference H").locator("input").fill("3")
        button(page, "TIN (exact)")
        button(page, "Compute")
        wait(page, "() => [...document.querySelectorAll('table.kv td')].some(td => td.textContent.includes('Cut (above ref)'))", 60)
        page.locator("text=Cut (above ref)").scroll_into_view_if_needed()
        settle(page, 800)
        shot(page, "05-volume-stockpile.jpg")
        page.evaluate("() => window.__spl.analysis.getState().set({ volumePolygon: null })")
        button(page, "Navigate")

        # change detection between cleaned epochs
        show_only(page, "d => d.epoch === 'B' && d.sourceFormat === 'synthetic'")
        run_job(page, "Clean (SOR)")
        run_job(page, "Change detection (ΔZ)")
        page.evaluate("() => window.__spl.store.getState().set({ dzRange: 0.05 })")
        look(page, L(95, 45, 3), 70)
        shot(page, "06-change-detection.jpg")

        # as-built inspection of the pit on cleaned epoch A
        show_only(page, "d => d.epoch === 'A' && d.meta?.derivedBy === 'clean'")
        run_job(page, "As-built check")
        look(page, L(40, 35, 1.5), 38)
        page.locator(".verdict").scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        shot(page, "07-asbuilt-inspection.jpg")

        # photo view (oblique RTK photo aligned with the cloud)
        show_only(page, "d => d.epoch === 'A' && d.sourceFormat === 'synthetic'")
        page.evaluate("() => window.__spl.store.getState().set({ colorMode: 'rgb' })")
        settle(page, 1000)
        page.locator(".thumb", has_text="DJI_0009").click()
        page.wait_for_timeout(800)
        page.locator(".photo-bar input[type=range]").fill("0.5")
        settle(page, 1500)
        shot(page, "08-photo-overlay.jpg")
        button(page, "Exit photo view")

        # 3D Gaussian Splatting layer
        look(page, L(85, 60, 5), 45)
        page.get_by_role("button", name="Show as 3D Gaussian Splats").click()
        wait(page, "() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Hide 3DGS'))", 120)
        page.locator("label", has_text="points too").locator("input").uncheck()
        page.wait_for_timeout(3000)
        shot(page, "09-gaussian-splats.jpg")
        browser.close()


if __name__ == "__main__":
    main()
