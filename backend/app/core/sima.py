"""SIMA (測量データ共通フォーマット, JSIMA) read/write. Spec: docs/specs/sima-dxf.md

Encoding CP932 (Shift-JIS). Coordinates in the Japanese convention: X = north, Y = east.
Records:  G00 header · Z00 comment/section · A00/A01/A99 coordinate section ·
          D00 parcel start / B01 member point / D99 parcel end.
Unknown records are preserved (raw) and reported as warnings.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SimaPoint:
    number: int
    name: str
    X: float  # north
    Y: float  # east
    H: float | None = None


@dataclass
class SimaParcel:
    number: int
    name: str
    members: list[tuple[int, str]] = field(default_factory=list)  # (point number, point name)
    record: str = "D00"


@dataclass
class SimaFile:
    site_name: str = ""
    version: str = "03"
    points: list[SimaPoint] = field(default_factory=list)
    parcels: list[SimaParcel] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    encoding: str = "cp932"


def _num(v: float | None) -> str:
    return "" if v is None else f"{v:.4f}"


_CP932_TRANSLIT = (
    ("m²", "m2"),
    ("m³", "m3"),
    ("²", "2"),
    ("³", "3"),
    ("·", "/"),
    ("–", "-"),
    ("—", "-"),
    ("≥", ">="),
    ("≤", "<="),
    ("⚠", "!"),
    ("✕", "x"),
)


def _cp932_safe(text: str) -> str:
    """Transliterate common non-CP932 survey symbols and replace unencodable characters."""
    s = str(text or "")
    for src, dst in _CP932_TRANSLIT:
        s = s.replace(src, dst)
    return s.encode("cp932", errors="replace").decode("cp932")


def write_sima(f: SimaFile) -> bytes:
    lines = [f"G00,{f.version},{_cp932_safe(f.site_name)},", "Z00,座標データ,", "A00,"]
    for p in f.points:
        lines.append(f"A01,{p.number},{_cp932_safe(p.name)},{_num(p.X)},{_num(p.Y)},{_num(p.H)},")
    lines.append("A99,")
    if f.parcels:
        lines.append("Z00,区画データ,")
        for parcel in f.parcels:
            lines.append(f"D00,{parcel.number},{_cp932_safe(parcel.name)},{len(parcel.members)},")
            for num, name in parcel.members:
                lines.append(f"B01,{num},{_cp932_safe(name)},")
            lines.append("D99,")
    return ("\r\n".join(lines) + "\r\n").encode("cp932", errors="replace")


def _decode(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8"), "utf-8-sig"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp932", errors="replace"), "cp932"


def _float(s: str) -> float | None:
    s = s.strip()
    return float(s) if s else None


def read_sima(data: bytes) -> SimaFile:
    text, enc = _decode(data)
    out = SimaFile(encoding=enc)
    current: SimaParcel | None = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        fields = [x.strip() for x in line.split(",")]
        rec = fields[0].upper()
        try:
            if rec == "G00":
                out.version = fields[1] if len(fields) > 1 else ""
                out.site_name = fields[2] if len(fields) > 2 else ""
            elif rec in ("Z00", "A00", "A99"):
                pass
            elif rec == "A01":
                X, Y = _float(fields[3]), _float(fields[4])
                if X is None or Y is None:
                    raise ValueError("missing X/Y")
                H = _float(fields[5]) if len(fields) > 5 else None
                out.points.append(SimaPoint(int(fields[1]), fields[2], X, Y, H))
            elif rec.startswith("D") and rec != "D99":
                current = SimaParcel(int(fields[1]) if len(fields) > 1 and fields[1] else 0,
                                     fields[2] if len(fields) > 2 else "", record=rec)
                out.parcels.append(current)
            elif rec == "B01":
                if current is None:
                    out.warnings.append(f"line {lineno}: B01 outside a D00 block")
                    continue
                current.members.append((int(fields[1]), fields[2] if len(fields) > 2 else ""))
            elif rec == "D99":
                current = None
            else:
                out.unknown.append(raw)
                out.warnings.append(f"line {lineno}: unsupported record {rec} kept as raw text")
        except (ValueError, IndexError) as exc:
            out.warnings.append(f"line {lineno}: cannot parse {rec}: {exc}")
    return out
