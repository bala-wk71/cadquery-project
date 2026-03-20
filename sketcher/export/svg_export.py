"""Export a Sketch to SVG format using *svgwrite*.

Supported entity types
----------------------
Point, Line, Circle, Arc, Ellipse, Rectangle, Polygon, Spline, Polyline.

Each entity's ``layer`` attribute is looked up to obtain stroke colour and
line-style information.  Dimension constraints can optionally be rendered as
SVG text annotations.
"""

from __future__ import annotations

import math
from io import StringIO
from typing import TYPE_CHECKING

import svgwrite
from svgwrite.container import Group

if TYPE_CHECKING:
    from solver.sketch_model import Sketch

# ── Defaults ────────────────────────────────────────────────────────────────
_DEFAULT_STROKE = "#000000"
_DEFAULT_STROKE_WIDTH = 0.5
_POINT_RADIUS = 1.5
_DIM_FONT_SIZE = 10
_DIM_FILL = "#555555"

# Mapping from user-facing dash names to SVG stroke-dasharray values.
_DASH_PATTERNS: dict[str, str | None] = {
    "solid": None,
    "dashed": "6,3",
    "dotted": "1.5,3",
    "dashdot": "6,3,1.5,3",
    "center": "12,3,3,3",
}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _layer_style(sketch: Sketch, entity: dict) -> dict:
    """Return an SVG attribute dict for the entity's layer style."""
    layer_name = entity.get("layer", "default")
    layers = {l.get("name"): l for l in sketch.to_dict().get("layers", [])}
    layer = layers.get(layer_name, {})

    stroke = layer.get("color", _DEFAULT_STROKE)
    width = layer.get("lineWidth", _DEFAULT_STROKE_WIDTH)
    line_style = layer.get("lineStyle", "solid")

    attrs: dict = {
        "stroke": stroke,
        "stroke_width": width,
        "fill": "none",
    }
    dash = _DASH_PATTERNS.get(line_style)
    if dash:
        attrs["stroke_dasharray"] = dash
    return attrs


def _svg_arc_path(cx: float, cy: float, r: float,
                  start_angle: float, end_angle: float) -> str:
    """Return an SVG path ``d`` attribute string for a circular arc.

    Angles are in **radians**, measured counter-clockwise from the +X axis.
    """
    x1 = cx + r * math.cos(start_angle)
    y1 = cy + r * math.sin(start_angle)
    x2 = cx + r * math.cos(end_angle)
    y2 = cy + r * math.sin(end_angle)

    # Determine if the arc spans more than 180 degrees.
    diff = (end_angle - start_angle) % (2 * math.pi)
    large_arc = 1 if diff > math.pi else 0
    sweep = 1  # counter-clockwise positive → SVG sweep-flag 1

    return (
        f"M {x1:.6f},{y1:.6f} "
        f"A {r:.6f},{r:.6f} 0 {large_arc},{sweep} {x2:.6f},{y2:.6f}"
    )


def _ellipse_point(cx, cy, rx, ry, rotation, t):
    """Point on an ellipse at parameter *t* (radians)."""
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)
    px = rx * math.cos(t)
    py = ry * math.sin(t)
    x = cx + cos_r * px - sin_r * py
    y = cy + sin_r * px + cos_r * py
    return x, y


def _polyline_d(points: list[tuple[float, float]], closed: bool = False) -> str:
    """Build an SVG path ``d`` string from a sequence of (x, y) tuples."""
    if not points:
        return ""
    parts = [f"M {points[0][0]:.6f},{points[0][1]:.6f}"]
    for x, y in points[1:]:
        parts.append(f"L {x:.6f},{y:.6f}")
    if closed:
        parts.append("Z")
    return " ".join(parts)


def _catmull_rom_to_bezier(pts: list[tuple[float, float]],
                           closed: bool = False) -> str:
    """Approximate a Catmull-Rom spline as cubic Bezier SVG path commands."""
    if len(pts) < 2:
        return ""
    if closed:
        pts = [pts[-1]] + pts + [pts[0], pts[1]]
    else:
        pts = [pts[0]] + pts + [pts[-1]]

    d_parts = [f"M {pts[1][0]:.6f},{pts[1][1]:.6f}"]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        cp1x = p1[0] + (p2[0] - p0[0]) / 6
        cp1y = p1[1] + (p2[1] - p0[1]) / 6
        cp2x = p2[0] - (p3[0] - p1[0]) / 6
        cp2y = p2[1] - (p3[1] - p1[1]) / 6
        d_parts.append(
            f"C {cp1x:.6f},{cp1y:.6f} {cp2x:.6f},{cp2y:.6f} "
            f"{p2[0]:.6f},{p2[1]:.6f}"
        )
    if closed:
        d_parts.append("Z")
    return " ".join(d_parts)


# ── Entity converters ──────────────────────────────────────────────────────

def _add_point(dwg: svgwrite.Drawing, group: Group,
               entity: dict, style: dict) -> None:
    x = entity.get("x", 0)
    y = entity.get("y", 0)
    group.add(dwg.circle(
        center=(x, y),
        r=_POINT_RADIUS,
        fill=style.get("stroke", _DEFAULT_STROKE),
        stroke="none",
    ))


def _add_line(dwg: svgwrite.Drawing, group: Group,
              entity: dict, style: dict) -> None:
    group.add(dwg.line(
        start=(entity.get("x1", 0), entity.get("y1", 0)),
        end=(entity.get("x2", 0), entity.get("y2", 0)),
        **style,
    ))


def _add_circle(dwg: svgwrite.Drawing, group: Group,
                entity: dict, style: dict) -> None:
    group.add(dwg.circle(
        center=(entity.get("cx", 0), entity.get("cy", 0)),
        r=entity.get("radius", 0),
        **style,
    ))


def _add_arc(dwg: svgwrite.Drawing, group: Group,
             entity: dict, style: dict) -> None:
    cx = entity.get("cx", 0)
    cy = entity.get("cy", 0)
    r = entity.get("radius", 0)
    sa = entity.get("startAngle", 0)
    ea = entity.get("endAngle", math.pi)
    d = _svg_arc_path(cx, cy, r, sa, ea)
    group.add(dwg.path(d=d, **style))


def _add_ellipse(dwg: svgwrite.Drawing, group: Group,
                 entity: dict, style: dict) -> None:
    cx = entity.get("cx", 0)
    cy = entity.get("cy", 0)
    rx = entity.get("rx", 0)
    ry = entity.get("ry", 0)
    rotation = entity.get("rotation", 0)

    # If no rotation, use the native SVG ellipse element.
    if abs(rotation) < 1e-9:
        group.add(dwg.ellipse(
            center=(cx, cy),
            r=(rx, ry),
            **style,
        ))
    else:
        # Approximate with a polyline for rotated ellipses.
        steps = 64
        pts = [
            _ellipse_point(cx, cy, rx, ry, rotation, 2 * math.pi * i / steps)
            for i in range(steps + 1)
        ]
        d = _polyline_d(pts, closed=True)
        group.add(dwg.path(d=d, **style))


def _add_rectangle(dwg: svgwrite.Drawing, group: Group,
                   entity: dict, style: dict) -> None:
    x = entity.get("x", 0)
    y = entity.get("y", 0)
    w = entity.get("width", 0)
    h = entity.get("height", 0)
    rotation = entity.get("rotation", 0)

    rect = dwg.rect(insert=(x, y), size=(w, h), **style)
    if abs(rotation) > 1e-9:
        angle_deg = math.degrees(rotation)
        rect.rotate(angle_deg, center=(x + w / 2, y + h / 2))
    group.add(rect)


def _add_polygon(dwg: svgwrite.Drawing, group: Group,
                 entity: dict, style: dict) -> None:
    points = entity.get("points", [])
    if not points:
        return
    coords = [(p.get("x", 0), p.get("y", 0)) for p in points]
    group.add(dwg.polygon(points=coords, **style))


def _add_spline(dwg: svgwrite.Drawing, group: Group,
                entity: dict, style: dict) -> None:
    points = entity.get("points", [])
    if len(points) < 2:
        return
    coords = [(p.get("x", 0), p.get("y", 0)) for p in points]
    closed = entity.get("closed", False)
    d = _catmull_rom_to_bezier(coords, closed=closed)
    group.add(dwg.path(d=d, **style))


def _add_polyline(dwg: svgwrite.Drawing, group: Group,
                  entity: dict, style: dict) -> None:
    points = entity.get("points", [])
    if len(points) < 2:
        return
    coords = [(p.get("x", 0), p.get("y", 0)) for p in points]
    group.add(dwg.polyline(points=coords, **style))


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


# ── Dimension text ──────────────────────────────────────────────────────────

def _add_dimension_annotations(dwg: svgwrite.Drawing, group: Group,
                               sketch: Sketch) -> None:
    """Render dimension constraints as text labels at the midpoint of
    involved entities."""
    sketch_dict = sketch.to_dict()
    entities_by_id = {e["id"]: e for e in sketch_dict.get("entities", [])}

    for con in sketch_dict.get("constraints", []):
        ctype = con.get("type", "")
        if "distance" not in ctype.lower() and "angle" not in ctype.lower():
            continue

        value = con.get("value")
        if value is None:
            continue

        # Try to position the label near the first referenced entity.
        entity_ids = con.get("entityIds", [])
        if not entity_ids:
            continue

        ent = entities_by_id.get(entity_ids[0], {})
        tx = ent.get("cx", ent.get("x", ent.get("x1", 0)))
        ty = ent.get("cy", ent.get("y", ent.get("y1", 0)))

        label = f"{value:.2f}" if isinstance(value, float) else str(value)
        group.add(dwg.text(
            label,
            insert=(tx + 4, ty - 4),
            font_size=_DIM_FONT_SIZE,
            fill=_DIM_FILL,
            font_family="sans-serif",
        ))


# ── Public API ──────────────────────────────────────────────────────────────

def export_svg(
    sketch: Sketch,
    *,
    width: float | None = None,
    height: float | None = None,
    include_dimensions: bool = True,
    filepath: str | None = None,
) -> str:
    """Convert *sketch* to an SVG string.

    Parameters
    ----------
    sketch:
        The sketch model to export.
    width, height:
        Optional explicit canvas dimensions.  When *None* the viewBox is
        computed from the entity bounding-box with a small margin.
    include_dimensions:
        If ``True``, dimension constraint values are rendered as text labels.
    filepath:
        If given, the SVG is also written to this path on disk.

    Returns
    -------
    str
        The SVG document as a Unicode string.
    """
    sketch_dict = sketch.to_dict()
    entities = sketch_dict.get("entities", [])

    # Compute bounding-box for viewBox.
    xs: list[float] = []
    ys: list[float] = []
    for e in entities:
        for key in ("x", "x1", "x2", "cx"):
            if key in e:
                xs.append(e[key])
        for key in ("y", "y1", "y2", "cy"):
            if key in e:
                ys.append(e[key])
        for p in e.get("points", []):
            xs.append(p.get("x", 0))
            ys.append(p.get("y", 0))
        if "radius" in e:
            cx, cy, r = e.get("cx", 0), e.get("cy", 0), e["radius"]
            xs.extend([cx - r, cx + r])
            ys.extend([cy - r, cy + r])
        if "rx" in e:
            cx, cy = e.get("cx", 0), e.get("cy", 0)
            rx, ry = e.get("rx", 0), e.get("ry", 0)
            xs.extend([cx - rx, cx + rx])
            ys.extend([cy - ry, cy + ry])
        if "width" in e and "height" in e:
            x, y = e.get("x", 0), e.get("y", 0)
            xs.extend([x, x + e["width"]])
            ys.extend([y, y + e["height"]])

    margin = 20
    if xs and ys:
        min_x, max_x = min(xs) - margin, max(xs) + margin
        min_y, max_y = min(ys) - margin, max(ys) + margin
    else:
        min_x, min_y, max_x, max_y = 0, 0, 800, 600

    vb_w = max_x - min_x
    vb_h = max_y - min_y
    canvas_w = width or vb_w
    canvas_h = height or vb_h

    dwg = svgwrite.Drawing(
        size=(f"{canvas_w}px", f"{canvas_h}px"),
        viewBox=f"{min_x} {min_y} {vb_w} {vb_h}",
    )
    root_group = dwg.g(id="sketch")

    for entity in entities:
        etype = entity.get("type", "").lower()
        handler = _ENTITY_HANDLERS.get(etype)
        if handler is None:
            continue
        style = _layer_style(sketch, entity)
        handler(dwg, root_group, entity, style)

    if include_dimensions:
        _add_dimension_annotations(dwg, root_group, sketch)

    dwg.add(root_group)

    svg_str = dwg.tostring()

    if filepath:
        with open(filepath, "w", encoding="utf-8") as fh:
            fh.write(svg_str)

    return svg_str
