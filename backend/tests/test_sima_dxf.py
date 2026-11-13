"""docs/specs/sima-dxf.md: SIMA CP932 round trip, axis convention, fixture; DXF re-read."""
import io
from pathlib import Path

import ezdxf
import numpy as np
import pytest

from app.core import dxf, sima
from app.synthetic import site

FIXTURE = Path(__file__).parent / "fixtures" / "sample.sim"


def test_sima_round_trip_cp932(metric):
    pts = [sima.SimaPoint(cp["number"], cp["name"], cp["N"], cp["E"], cp["H"]) for cp in site.control_points()]
    pts.append(sima.SimaPoint(99, "仮BM", -39000.1234, -4300.5678, None))
    f = sima.SimaFile(site_name="豊洲工事現場", points=pts, parcels=[sima.SimaParcel(1, "掘削範囲", [(1, "基準点1"), (2, "基準点2"), (3, "基準点3")])])
    data = sima.write_sima(f)
    data.decode("cp932")  # valid Shift-JIS bytes
    assert "基準点1".encode("cp932") in data
    back = sima.read_sima(data)
    assert back.encoding == "cp932" and back.site_name == "豊洲工事現場"
    worst = max(max(abs(a.X - b.X), abs(a.Y - b.Y), abs((a.H or 0) - (b.H or 0))) for a, b in zip(pts, back.points))
    metric("SIMA", "CP932 write -> read round trip (7 points)", worst * 1000, 0.1)
    assert worst <= 0.5e-4  # 4 decimals
    assert [p.name for p in back.points] == [p.name for p in pts]
    assert back.points[-1].H is None
    assert back.parcels[0].members == [(1, "基準点1"), (2, "基準点2"), (3, "基準点3")]
    assert not back.warnings


def test_sima_axis_convention():
    """A point at E = 100, N = 200 must be written X = 200 (north), Y = 100 (east)."""
    data = sima.write_sima(sima.SimaFile(points=[sima.SimaPoint(1, "P", X=200.0, Y=100.0, H=5.0)]))
    line = next(ln for ln in data.decode("cp932").splitlines() if ln.startswith("A01"))
    assert line == "A01,1,P,200.0000,100.0000,5.0000,"


def test_sima_fixture_file():
    f = sima.read_sima(FIXTURE.read_bytes())
    assert f.site_name == "テスト現場"
    assert [p.name for p in f.points] == ["T1", "T2", "境界1", "境界2"]
    assert f.points[2].X == pytest.approx(-35400.1234) and f.points[2].Y == pytest.approx(-6000.5678)
    assert f.parcels[0].name == "画地A" and len(f.parcels[0].members) == 2
    assert any("X99" in w for w in f.warnings) and f.unknown  # unknown record preserved


def test_sima_utf8_and_bad_lines():
    data = "G00,03,UTF8現場,\nA01,1,P1,1.0,2.0,3.0,\nA01,2,P2,,2.0,3.0,\n".encode("utf-8")
    f = sima.read_sima(data)
    assert f.encoding == "utf-8" and len(f.points) == 1
    assert any("line 3" in w for w in f.warnings)


def test_dxf_plan_round_trip(metric):
    cps = site.control_points()
    pts = [{"name": cp["name"], "E": cp["E"], "N": cp["N"], "H": cp["H"]} for cp in cps]
    a, b = [-4170.0239, -38955.1405, 3.4971], [-4140.0292, -38955.1489, 4.9998]
    data = dxf.plan_dxf(points=pts, lines=[{"label": "30.0324 m", "a": a, "b": b}],
                        boundaries=[{"label": "pile", "points": [[-4220, -38945], [-4210, -38945], [-4210, -38935]]}])
    doc = ezdxf.read(io.StringIO(data.decode("utf-8")))
    auditor = doc.audit()
    assert not auditor.has_errors
    assert doc.header["$INSUNITS"] == 6
    msp = doc.modelspace()
    got = [e.dxf.location for e in msp.query("POINT[layer=='SURVEY_POINTS']")]
    worst = max(max(abs(g.x - p["E"]), abs(g.y - p["N"]), abs(g.z - p["H"])) for g, p in zip(got, pts))
    metric("DXF", "plan export -> ezdxf re-read: survey points", worst * 1000, 0.1)
    assert worst <= 1e-4
    line = msp.query("LINE[layer=='MEASUREMENTS']")[0]
    assert abs(line.dxf.start.x - a[0]) < 1e-9 and abs(line.dxf.end.z - b[2]) < 1e-9
    assert len(msp.query("LWPOLYLINE[layer=='VOLUME_BOUNDARY']")) == 1


def test_dxf_profile_and_design_tin(metric):
    s = np.linspace(0, 40, 161)
    z = 3 + 0.05 * s
    doc = ezdxf.read(io.StringIO(dxf.profile_dxf(s, z, title="SEC-1").decode("utf-8")))
    pl = doc.modelspace().query("LWPOLYLINE[layer=='PROFILE']")[0]
    v = np.array([(p[0], p[1]) for p in pl.get_points()])
    err = float(np.max(np.abs(v[:, 1] - z)))
    metric("DXF", "profile export -> re-read: station/elevation vertices", err * 1000, 0.1)
    assert err <= 1e-4 and np.allclose(v[:, 0], s)
    verts, tris = site.design_tin()
    v2, t2 = dxf.read_design_tin(dxf.design_tin_dxf(verts, tris))
    assert len(t2) == len(tris) and len(v2) == len(verts)
    assert np.allclose(np.sort(v2, axis=0), np.sort(verts, axis=0), atol=1e-6)


def test_sima_write_cp932_and_transliterates_survey_symbols():
    f = sima.SimaFile(
        site_name="豊洲現場 ΔZ ±50mm — 面積m²/土量m³ · ≥1点 ≤100m ⚠🚧",
        points=[
            sima.SimaPoint(1, "基準点1カタカナΔ±", X=-38955.0, Y=-4170.0, H=3.5),
            sima.SimaPoint(2, "面積m²·土量m³—≥1≤2⚠", X=-38950.0, Y=-4165.0, H=4.0),
        ],
        parcels=[
            sima.SimaParcel(1, "掘削範囲—m³≥0⚠", [(1, "基準点1カタカナΔ±"), (2, "面積m²·土量m³—≥1≤2⚠")]),
        ],
    )
    data = sima.write_sima(f)
    text = data.decode("cp932")
    assert "Z00,座標データ," in text
    assert "Z00,区画データ," in text
    assert "基準点1カタカナΔ±" in text
    assert "面積m2/土量m3->=1<=2!" in text
    assert "m2" in text and "m3" in text and ">=" in text and "<=" in text
    assert "豊洲現場 ΔZ ±50mm - 面積m2/土量m3 / >=1点 <=100m !?" in text
    back = sima.read_sima(data)
    assert back.encoding == "cp932"
    assert back.points[0].name == "基準点1カタカナΔ±"
    assert back.points[1].name == "面積m2/土量m3->=1<=2!"


def test_dxf_japanese_labels_cjk_style_and_text_entities():
    plan_bytes = dxf.plan_dxf(
        points=[{"name": "基準点1", "E": -4170.0, "N": -38955.0, "H": 3.5}],
        lines=[{"label": "30.0324 m / 5.010%", "a": [-4170.0, -38955.0, 3.5], "b": [-4140.0, -38955.0, 5.0]}],
        polylines=[
            {"label": "法線測線1", "points": [[-4170.0, -38955.0, 3.5], [-4150.0, -38950.0, 4.0]]},
            {"label": "", "points": [[-4160.0, -38945.0, 3.5], [-4145.0, -38940.0, 4.0]]},
        ],
        boundaries=[
            {"label": "土量計測範囲", "points": [[-4220.0, -38945.0], [-4210.0, -38945.0], [-4210.0, -38935.0]]},
            {"label": "", "points": [[-4200.0, -38945.0], [-4190.0, -38945.0], [-4190.0, -38935.0]]},
        ],
    )
    doc = ezdxf.read(io.StringIO(plan_bytes.decode("utf-8")))
    assert not doc.audit().has_errors
    assert "CJK" in doc.styles
    assert doc.styles.get("CJK").dxf.font == "msgothic.ttc"
    assert doc.styles.get("Standard").dxf.bigfont == "extfont2.shx"

    msp = doc.modelspace()
    survey_texts = [e.dxf.text for e in msp.query("TEXT[layer=='SURVEY_POINTS']")]
    meas_texts = [e.dxf.text for e in msp.query("TEXT[layer=='MEASUREMENTS']")]
    boundary_texts = [e.dxf.text for e in msp.query("TEXT[layer=='VOLUME_BOUNDARY']")]
    assert survey_texts == ["基準点1"]
    assert meas_texts == ["30.0324 m / 5.010%", "法線測線1"]
    assert boundary_texts == ["土量計測範囲"]

    s = np.linspace(0, 20, 21)
    z = 3.0 + 0.05 * s
    prof_bytes = dxf.profile_dxf(s, z, title="縦断図 断面1 (20.00 m)")
    prof_doc = ezdxf.read(io.StringIO(prof_bytes.decode("utf-8")))
    assert not prof_doc.audit().has_errors
    assert "CJK" in prof_doc.styles
    prof_texts = [e.dxf.text for e in prof_doc.modelspace().query("TEXT[layer=='PROFILE']")]
    assert prof_texts == ["縦断図 断面1 (20.00 m)"]
