"""Export a Sketch to DXF format using *ezdxf*.

Supported entity types
----------------------
Point, Line, Circle, Arc, Ellipse, Rectangle, Polygon, Spline, Polyline.

Layers defined on the sketch are mapped to DXF layers with matching names
and colours (using the nearest ACI colour).
"""

from __future__ import annotations

import math
from io import BytesIO
from typing import TYPE_CHECKING

import ezdxf
from ezdxf.math import Vec3

if TYPE_CHECKING:
    from solver.sketch_model import Sketch

# ── Colour helpers ──────────────────────────────────────────────────────────

# A small palette mapping common hex colours to AutoCAD Color Index values.
_HEX_TO_ACI: dict[str, int] = {
    "#ff0000": 1,
    "#ffff00": 2,
    "#00ff00": 3,
    "#00ffff": 4,
    "#0000ff": 5,
    "#ff00ff": 6,
    "#ffffff": 7,
    "#000000": 7,  # black → white-on-dark (ACI 7 is "white/black")
    "#808080": 8,
    "#c0c0c0": 9,
}


def _hex_to_aci(hex_color: str) -> int:
    """Best-effort conversion of a hex colour string to ACI (1-255)."""
    normalised = hex_color.strip().lower()
    if normalised in _HEX_TO_ACI:
        return _HEX_TO_ACI[normalised]
    # Fallback: return ACI 7 (white/black).
    return 7


# ── Layer setup ─────────────────────────────────────────────────────────────

def _setup_layers(doc: ezdxf.document.Drawing, sketch_dict: dict) -> None:
    """Create DXF layers that correspond to sketch layers."""
    for layer in sketch_dict.get("layers", []):
        name = layer.get("name", "default")
        color = layer.get("color", "#000000")
        aci = _hex_to_aci(color)
        if name not in doc.layers:
            doc.layers.add(name, color=aci)


def _entity_layer(entity: dict) -> str:
    return entity.get("layer", "0")


# ── Entity converters ──────────────────────────────────────────────────────

def _add_point(msp, entity: dict) -> None:
    x = entity.get("x", 0)
    y = entity.get("y", 0)
    msp.add_point(
        (x, y),
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_line(msp, entity: dict) -> None:
    msp.add_line(
        (entity.get("x1", 0), entity.get("y1", 0)),
        (entity.get("x2", 0), entity.get("y2", 0)),
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_circle(msp, entity: dict) -> None:
    msp.add_circle(
        center=(entity.get("cx", 0), entity.get("cy", 0)),
        radius=entity.get("radius", 0),
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_arc(msp, entity: dict) -> None:
    cx = entity.get("cx", 0)
    cy = entity.get("cy", 0)
    r = entity.get("radius", 0)
    # Sketch stores angles in radians; DXF expects degrees.
    sa_deg = math.degrees(entity.get("startAngle", 0))
    ea_deg = math.degrees(entity.get("endAngle", math.pi))
    msp.add_arc(
        center=(cx, cy),
        radius=r,
        start_angle=sa_deg,
        end_angle=ea_deg,
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_ellipse(msp, entity: dict) -> None:
    cx = entity.get("cx", 0)
    cy = entity.get("cy", 0)
    rx = entity.get("rx", 0)
    ry = entity.get("ry", 0)
    rotation = entity.get("rotation", 0)

    # ezdxf ellipse takes centre, major-axis vector, and ratio (minor/major).
    if rx >= ry:
        major_axis = Vec3(rx * math.cos(rotation), rx * math.sin(rotation), 0)
        ratio = ry / rx if rx else 1.0
    else:
        major_axis = Vec3(
            ry * math.cos(rotation + math.pi / 2),
            ry * math.sin(rotation + math.pi / 2),
            0,
        )
        ratio = rx / ry if ry else 1.0

    msp.add_ellipse(
        center=(cx, cy, 0),
        major_axis=major_axis,
        ratio=ratio,
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_rectangle(msp, entity: dict) -> None:
    """Add a rectangle as a closed LWPOLYLINE."""
    x = entity.get("x", 0)
    y = entity.get("y", 0)
    w = entity.get("width", 0)
    h = entity.get("height", 0)
    rotation = entity.get("rotation", 0)

    corners = [
        (x, y),
        (x + w, y),
        (x + w, y + h),
        (x, y + h),
    ]

    if abs(rotation) > 1e-9:
        cx_r = x + w / 2
        cy_r = y + h / 2
        cos_r, sin_r = math.cos(rotation), math.sin(rotation)
        rotated = []
        for px, py in corners:
            dx, dy = px - cx_r, py - cy_r
            rotated.append((
                cx_r + cos_r * dx - sin_r * dy,
                cy_r + sin_r * dx + cos_r * dy,
            ))
        corners = rotated

    msp.add_lwpolyline(
        corners,
        close=True,
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_polygon(msp, entity: dict) -> None:
    points = entity.get("points", [])
    if len(points) < 3:
        return
    coords = [(p.get("x", 0), p.get("y", 0)) for p in points]
    msp.add_lwpolyline(
        coords,
        close=True,
        dxfattribs={"layer": _entity_layer(entity)},
    )


def _add_spline(msp, entity: dict) -> None:
    points = entity.get("points", [])
    if len(points) < 2:
        return
    fit_points = [(p.get("x", 0), p.get("y", 0), 0) for p in points]
    closed = entity.get("closed", False)

    spline = msp.add_spline(
        dxfattribs={"layer": _entity_layer(entity)},
    )
    spline.set_fit_points(fit_points)
    if closed:
        spline.closed = True


def _add_polyline(msp, entity: dict) -> None:
    points = entity.get("points", [])
    if len(points) < 2:
        return
    coords = [(p.get("x", 0), p.get("y", 0)) for p in points]
    msp.add_lwpolyline(
        coords,
        close=False,
        dxfattribs={"layer": _entity_layer(entity)},
    )


_ENTITY_HANDLERS: dict[str, callable] = {
    "point": _add_point,
    "line": _add_line,
    "circle": _add_circle,
    "arc": _add_arc,
    "ellipse": _add_ellipse,
    "rectangle": _add_rectangle,
    "polygon": _add_polygon,
    "spline": _add_spline,
    "polyline": _add_polyline,
}


# ── Public API ──────────────────────────────────────────────────────────────

def export_dxf(
    sketch: Sketch,
    *,
    filepath: str | None = None,
) -> bytes:
    """Convert *sketch* to a DXF document and return the raw bytes.

    Parameters
    ----------
    sketch:
        The sketch model to export.
    filepath:
        If given, the DXF is also saved to this path on disk.

    Returns
    -------
    bytes
        The DXF file content.
    """
    sketch_dict = sketch.to_dict()
    entities = sketch_dict.get("entities", [])

    doc = ezdxf.new(dxfversion="R2010")
    _setup_layers(doc, sketch_dict)
    msp = doc.modelspace()

    for entity in entities:
        etype = entity.get("type", "").lower()
        handler = _ENTITY_HANDLERS.get(etype)
        if handler is None:
            continue
        handler(msp, entity)

    # Serialise to bytes via an in-memory stream.
    stream = BytesIO()
    doc.write(stream)
    raw = stream.getvalue()

    if filepath:
        doc.saveas(filepath)

    return raw
