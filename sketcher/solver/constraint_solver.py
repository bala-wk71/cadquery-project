"""
Constraint solver for a 2-D parametric sketch.

Strategy
--------
1. Pack every *free* (non-fixed) geometric DOF into a flat float vector **x**.
2. Each constraint contributes one or more scalar error terms that are zero
   when the constraint is satisfied.
3. Minimise ``sum(error_i ** 2)`` with ``scipy.optimize.minimize`` (L-BFGS-B).
4. Unpack **x** back into the sketch entities.

Public API
----------
- ``solve(sketch) -> SolveResult``
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import numpy as np
from scipy.optimize import minimize  # type: ignore[import-untyped]

from .geometry import (
    EPSILON,
    angle_of_line,
    line_direction,
    midpoint,
    nearest_point_on_circle,
    nearest_point_on_line,
    normalize_angle,
    point_distance,
    vec_cross,
    vec_dot,
    vec_normalize,
    vec_sub,
)
from .sketch_model import (
    Arc,
    Circle,
    Constraint,
    ConstraintType,
    Entity,
    EntityType,
    Line,
    Parameter,
    Point,
    Sketch,
)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class SolveResult:
    success: bool = False
    residual: float = 0.0
    iterations: int = 0
    dof: int = 0
    status: str = ""
    over_constrained: bool = False
    under_constrained: bool = False


# ---------------------------------------------------------------------------
# Parameter expression evaluator
# ---------------------------------------------------------------------------

_SAFE_BUILTINS = {
    "abs": abs, "min": min, "max": max,
    "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos,
    "tan": math.tan, "pi": math.pi, "e": math.e,
    "asin": math.asin, "acos": math.acos, "atan": math.atan,
    "atan2": math.atan2, "radians": math.radians, "degrees": math.degrees,
    "log": math.log, "log10": math.log10, "exp": math.exp,
    "pow": pow, "round": round, "ceil": math.ceil, "floor": math.floor,
}


def evaluate_parameters(
    parameters: List[Parameter],
) -> Dict[str, float]:
    """Topologically evaluate parameter expressions and return a name->value
    mapping.

    Raises ``ValueError`` on circular dependencies or bad expressions.
    """
    name_to_expr: Dict[str, str] = {p.name: p.expression for p in parameters}
    resolved: Dict[str, float] = {}
    visiting: Set[str] = set()

    _ident_re = re.compile(r"[A-Za-z_]\w*")

    def _resolve(name: str) -> float:
        if name in resolved:
            return resolved[name]
        if name in visiting:
            raise ValueError(f"Circular parameter dependency involving '{name}'")
        visiting.add(name)
        expr = name_to_expr[name]
        # Find referenced names (exclude math builtins)
        refs = {
            m for m in _ident_re.findall(expr)
            if m in name_to_expr and m != name
        }
        for ref in refs:
            _resolve(ref)
        ns: Dict[str, Any] = {**_SAFE_BUILTINS, **resolved}
        try:
            value = float(eval(expr, {"__builtins__": {}}, ns))  # noqa: S307
        except Exception as exc:
            raise ValueError(
                f"Cannot evaluate parameter '{name}' = '{expr}': {exc}"
            ) from exc
        resolved[name] = value
        visiting.discard(name)
        return value

    for name in name_to_expr:
        _resolve(name)
    return resolved


# ---------------------------------------------------------------------------
# DOF packing / unpacking
# ---------------------------------------------------------------------------

# Each entity type has a known set of free scalar DOFs.
_ENTITY_DOF_COUNT: Dict[EntityType, int] = {
    EntityType.POINT: 2,       # x, y
    EntityType.LINE: 4,        # x1, y1, x2, y2
    EntityType.CIRCLE: 3,      # cx, cy, r
    EntityType.ARC: 5,         # cx, cy, r, start_angle, end_angle
    EntityType.ELLIPSE: 5,     # cx, cy, rx, ry, rotation
    EntityType.RECTANGLE: 5,   # x, y, w, h, rotation
    # Polygon, Spline, Polyline: variable
}


def _entity_dof_count(entity: Entity) -> int:
    etype = entity.type
    if etype in _ENTITY_DOF_COUNT:
        return _ENTITY_DOF_COUNT[etype]
    if etype == EntityType.POLYGON:
        from .sketch_model import Polygon
        assert isinstance(entity, Polygon)  # noqa: S101
        return 2 * len(entity.vertices)
    if etype == EntityType.SPLINE:
        from .sketch_model import Spline
        assert isinstance(entity, Spline)  # noqa: S101
        return 2 * len(entity.control_points)
    if etype == EntityType.POLYLINE:
        from .sketch_model import Polyline
        assert isinstance(entity, Polyline)  # noqa: S101
        return 2 * len(entity.points)
    return 0


def _pack_entity(entity: Entity) -> List[float]:
    """Return the list of scalar DOFs for this entity."""
    t = entity.type
    if t == EntityType.POINT:
        assert isinstance(entity, Point)
        return [entity.x, entity.y]
    if t == EntityType.LINE:
        assert isinstance(entity, Line)
        return [entity.x1, entity.y1, entity.x2, entity.y2]
    if t == EntityType.CIRCLE:
        assert isinstance(entity, Circle)
        return [entity.cx, entity.cy, entity.radius]
    if t == EntityType.ARC:
        assert isinstance(entity, Arc)
        return [entity.cx, entity.cy, entity.radius,
                entity.start_angle, entity.end_angle]
    if t == EntityType.ELLIPSE:
        from .sketch_model import Ellipse
        assert isinstance(entity, Ellipse)
        return [entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation]
    if t == EntityType.RECTANGLE:
        from .sketch_model import Rectangle
        assert isinstance(entity, Rectangle)
        return [entity.x, entity.y, entity.width, entity.height,
                entity.rotation]
    if t == EntityType.POLYGON:
        from .sketch_model import Polygon
        assert isinstance(entity, Polygon)
        return [c for v in entity.vertices for c in v]
    if t == EntityType.SPLINE:
        from .sketch_model import Spline
        assert isinstance(entity, Spline)
        return [c for p in entity.control_points for c in p]
    if t == EntityType.POLYLINE:
        from .sketch_model import Polyline
        assert isinstance(entity, Polyline)
        return [c for p in entity.points for c in p]
    return []


def _unpack_entity(entity: Entity, values: List[float]) -> None:
    """Write *values* back into the entity's geometry fields."""
    t = entity.type
    if t == EntityType.POINT:
        assert isinstance(entity, Point)
        entity.x, entity.y = values[0], values[1]
    elif t == EntityType.LINE:
        assert isinstance(entity, Line)
        entity.x1, entity.y1, entity.x2, entity.y2 = values[:4]
    elif t == EntityType.CIRCLE:
        assert isinstance(entity, Circle)
        entity.cx, entity.cy, entity.radius = values[:3]
    elif t == EntityType.ARC:
        assert isinstance(entity, Arc)
        (entity.cx, entity.cy, entity.radius,
         entity.start_angle, entity.end_angle) = values[:5]
    elif t == EntityType.ELLIPSE:
        from .sketch_model import Ellipse
        assert isinstance(entity, Ellipse)
        (entity.cx, entity.cy, entity.rx, entity.ry,
         entity.rotation) = values[:5]
    elif t == EntityType.RECTANGLE:
        from .sketch_model import Rectangle
        assert isinstance(entity, Rectangle)
        (entity.x, entity.y, entity.width, entity.height,
         entity.rotation) = values[:5]
    elif t == EntityType.POLYGON:
        from .sketch_model import Polygon
        assert isinstance(entity, Polygon)
        entity.vertices = [(values[i], values[i + 1])
                           for i in range(0, len(values), 2)]
    elif t == EntityType.SPLINE:
        from .sketch_model import Spline
        assert isinstance(entity, Spline)
        entity.control_points = [(values[i], values[i + 1])
                                 for i in range(0, len(values), 2)]
    elif t == EntityType.POLYLINE:
        from .sketch_model import Polyline
        assert isinstance(entity, Polyline)
        entity.points = [(values[i], values[i + 1])
                         for i in range(0, len(values), 2)]


# ---------------------------------------------------------------------------
# Helpers to extract canonical point positions from the flat vector
# ---------------------------------------------------------------------------

class _DOFMap:
    """Maps entity ids to their slice inside the global DOF vector."""

    def __init__(self, sketch: Sketch, fixed_ids: Set[str]) -> None:
        self.id_to_offset: Dict[str, int] = {}
        self.id_to_count: Dict[str, int] = {}
        self.entity_order: List[Entity] = []
        self.fixed_ids = fixed_ids
        offset = 0
        for e in sketch.entities:
            n = _entity_dof_count(e)
            self.id_to_offset[e.id] = offset
            self.id_to_count[e.id] = n
            self.entity_order.append(e)
            offset += n
        self.total_dof = offset

    def pack_all(self) -> np.ndarray:
        parts: List[float] = []
        for e in self.entity_order:
            parts.extend(_pack_entity(e))
        return np.array(parts, dtype=np.float64)

    def unpack_all(self, x: np.ndarray) -> None:
        for e in self.entity_order:
            off = self.id_to_offset[e.id]
            cnt = self.id_to_count[e.id]
            _unpack_entity(e, list(x[off: off + cnt]))

    # --- Point extraction helpers ---

    def point_xy(self, x: np.ndarray, entity_id: str,
                 point_index: Optional[int] = None) -> Tuple[float, float]:
        """Return (px, py) for the given entity + point_index.

        point_index semantics:
          Point entity: ignored (always the point itself)
          Line:  0 = start, 1 = end
          Circle: 0 = center
          Arc:  0 = center, 1 = start point, 2 = end point
          Rectangle: 0..3 = corners (TL, TR, BR, BL before rotation)
          Polygon/Polyline: vertex index
        """
        off = self.id_to_offset[entity_id]
        cnt = self.id_to_count[entity_id]
        vals = x[off: off + cnt]
        e = self._entity(entity_id)
        idx = point_index or 0

        if e.type == EntityType.POINT:
            return (float(vals[0]), float(vals[1]))
        if e.type == EntityType.LINE:
            if idx == 0:
                return (float(vals[0]), float(vals[1]))
            return (float(vals[2]), float(vals[3]))
        if e.type == EntityType.CIRCLE:
            return (float(vals[0]), float(vals[1]))
        if e.type == EntityType.ARC:
            if idx == 0:
                return (float(vals[0]), float(vals[1]))
            cx, cy, r, sa, ea = (float(v) for v in vals[:5])
            if idx == 1:
                return (cx + r * math.cos(sa), cy + r * math.sin(sa))
            return (cx + r * math.cos(ea), cy + r * math.sin(ea))
        if e.type == EntityType.ELLIPSE:
            return (float(vals[0]), float(vals[1]))
        if e.type == EntityType.RECTANGLE:
            # corners
            rx, ry, w, h, rot = (float(v) for v in vals[:5])
            corners = [(rx, ry), (rx + w, ry),
                       (rx + w, ry + h), (rx, ry + h)]
            cx_r, cy_r = rx + w / 2, ry + h / 2
            c = corners[idx % 4]
            if abs(rot) > EPSILON:
                cos_r, sin_r = math.cos(rot), math.sin(rot)
                dx, dy = c[0] - cx_r, c[1] - cy_r
                return (cx_r + dx * cos_r - dy * sin_r,
                        cy_r + dx * sin_r + dy * cos_r)
            return c
        # Polygon / Spline / Polyline — vertex by index
        vi = idx * 2
        return (float(vals[vi]), float(vals[vi + 1]))

    def line_endpoints(self, x: np.ndarray, eid: str) -> Tuple[
        Tuple[float, float], Tuple[float, float]
    ]:
        off = self.id_to_offset[eid]
        return (
            (float(x[off]), float(x[off + 1])),
            (float(x[off + 2]), float(x[off + 3])),
        )

    def circle_params(self, x: np.ndarray, eid: str) -> Tuple[
        float, float, float
    ]:
        off = self.id_to_offset[eid]
        return (float(x[off]), float(x[off + 1]), float(x[off + 2]))

    def arc_params(self, x: np.ndarray, eid: str) -> Tuple[
        float, float, float, float, float
    ]:
        off = self.id_to_offset[eid]
        return tuple(float(x[off + i]) for i in range(5))  # type: ignore[return-value]

    def _entity(self, eid: str) -> Entity:
        for e in self.entity_order:
            if e.id == eid:
                return e
        raise KeyError(f"Unknown entity '{eid}'")


# ---------------------------------------------------------------------------
# Constraint error functions
# ---------------------------------------------------------------------------
# Each function receives (x, dof_map, constraint) and returns a list of
# residual floats (ideally all zero when satisfied).

ErrorFn = Callable[[np.ndarray, _DOFMap, Constraint, Dict[str, float]],
                   List[float]]


def _err_coincident(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
    pi1 = c.point_indices[1] if len(c.point_indices) > 1 else None
    ax, ay = dm.point_xy(x, c.entity_ids[0], pi0)
    bx, by = dm.point_xy(x, c.entity_ids[1], pi1)
    return [ax - bx, ay - by]


def _err_horizontal(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    if len(c.entity_ids) == 1:
        e = dm._entity(c.entity_ids[0])
        if e.type == EntityType.LINE:
            (_, y1), (_, y2) = dm.line_endpoints(x, e.id)
            return [y2 - y1]
    if len(c.entity_ids) == 2:
        pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
        pi1 = c.point_indices[1] if len(c.point_indices) > 1 else None
        _, ay = dm.point_xy(x, c.entity_ids[0], pi0)
        _, by = dm.point_xy(x, c.entity_ids[1], pi1)
        return [ay - by]
    return []


def _err_vertical(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    if len(c.entity_ids) == 1:
        e = dm._entity(c.entity_ids[0])
        if e.type == EntityType.LINE:
            (x1, _), (x2, _) = dm.line_endpoints(x, e.id)
            return [x2 - x1]
    if len(c.entity_ids) == 2:
        pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
        pi1 = c.point_indices[1] if len(c.point_indices) > 1 else None
        ax, _ = dm.point_xy(x, c.entity_ids[0], pi0)
        bx, _ = dm.point_xy(x, c.entity_ids[1], pi1)
        return [ax - bx]
    return []


def _err_parallel(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    (ax1, ay1), (ax2, ay2) = dm.line_endpoints(x, c.entity_ids[0])
    (bx1, by1), (bx2, by2) = dm.line_endpoints(x, c.entity_ids[1])
    # cross product of direction vectors = 0
    da = (ax2 - ax1, ay2 - ay1)
    db = (bx2 - bx1, by2 - by1)
    return [da[0] * db[1] - da[1] * db[0]]


def _err_perpendicular(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    (ax1, ay1), (ax2, ay2) = dm.line_endpoints(x, c.entity_ids[0])
    (bx1, by1), (bx2, by2) = dm.line_endpoints(x, c.entity_ids[1])
    da = (ax2 - ax1, ay2 - ay1)
    db = (bx2 - bx1, by2 - by1)
    return [da[0] * db[0] + da[1] * db[1]]


def _err_tangent(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    e0 = dm._entity(c.entity_ids[0])
    e1 = dm._entity(c.entity_ids[1])

    # Line-Circle tangent
    if e0.type == EntityType.LINE and e1.type == EntityType.CIRCLE:
        (lx1, ly1), (lx2, ly2) = dm.line_endpoints(x, e0.id)
        cx, cy, r = dm.circle_params(x, e1.id)
        d = vec_sub((lx2, ly2), (lx1, ly1))
        f = vec_sub((lx1, ly1), (cx, cy))
        length = math.hypot(d[0], d[1])
        if length < EPSILON:
            return [0.0]
        dist = abs(d[0] * f[1] - d[1] * f[0]) / length
        return [dist - r]

    if e0.type == EntityType.CIRCLE and e1.type == EntityType.LINE:
        return _err_tangent(x, dm, Constraint(
            entity_ids=[c.entity_ids[1], c.entity_ids[0]],
            type=c.type,
        ), _p)

    # Circle-Circle tangent (external)
    if e0.type == EntityType.CIRCLE and e1.type == EntityType.CIRCLE:
        cx0, cy0, r0 = dm.circle_params(x, e0.id)
        cx1, cy1, r1 = dm.circle_params(x, e1.id)
        dist = math.hypot(cx1 - cx0, cy1 - cy0)
        return [dist - (r0 + r1)]

    # Line-Arc tangent (treat arc as circle for tangency)
    if e0.type == EntityType.LINE and e1.type == EntityType.ARC:
        (lx1, ly1), (lx2, ly2) = dm.line_endpoints(x, e0.id)
        cx, cy, r, *_ = dm.arc_params(x, e1.id)
        d = vec_sub((lx2, ly2), (lx1, ly1))
        f = vec_sub((lx1, ly1), (cx, cy))
        length = math.hypot(d[0], d[1])
        if length < EPSILON:
            return [0.0]
        dist = abs(d[0] * f[1] - d[1] * f[0]) / length
        return [dist - r]

    if e0.type == EntityType.ARC and e1.type == EntityType.LINE:
        return _err_tangent(x, dm, Constraint(
            entity_ids=[c.entity_ids[1], c.entity_ids[0]],
            type=c.type,
        ), _p)

    return [0.0]


def _err_concentric(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    c0x, c0y = dm.point_xy(x, c.entity_ids[0], 0)
    c1x, c1y = dm.point_xy(x, c.entity_ids[1], 0)
    return [c0x - c1x, c0y - c1y]


def _err_equal(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    e0 = dm._entity(c.entity_ids[0])
    e1 = dm._entity(c.entity_ids[1])

    # Equal-length lines
    if e0.type == EntityType.LINE and e1.type == EntityType.LINE:
        (ax1, ay1), (ax2, ay2) = dm.line_endpoints(x, e0.id)
        (bx1, by1), (bx2, by2) = dm.line_endpoints(x, e1.id)
        la = math.hypot(ax2 - ax1, ay2 - ay1)
        lb = math.hypot(bx2 - bx1, by2 - by1)
        return [la - lb]

    # Equal-radius circles / arcs
    if e0.type in (EntityType.CIRCLE, EntityType.ARC) and \
       e1.type in (EntityType.CIRCLE, EntityType.ARC):
        if e0.type == EntityType.CIRCLE:
            _, _, r0 = dm.circle_params(x, e0.id)
        else:
            _, _, r0, *_ = dm.arc_params(x, e0.id)
        if e1.type == EntityType.CIRCLE:
            _, _, r1 = dm.circle_params(x, e1.id)
        else:
            _, _, r1, *_ = dm.arc_params(x, e1.id)
        return [r0 - r1]

    return [0.0]


def _err_symmetric(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    """Two points symmetric about a third entity (line or point)."""
    pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
    pi1 = c.point_indices[1] if len(c.point_indices) > 1 else None
    ax, ay = dm.point_xy(x, c.entity_ids[0], pi0)
    bx, by = dm.point_xy(x, c.entity_ids[1], pi1)

    if len(c.entity_ids) >= 3:
        ref = dm._entity(c.entity_ids[2])
        if ref.type == EntityType.LINE:
            (lx1, ly1), (lx2, ly2) = dm.line_endpoints(x, ref.id)
            mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
            foot = nearest_point_on_line((mx, my), (lx1, ly1), (lx2, ly2))
            d_ab = vec_sub((bx, by), (ax, ay))
            d_line = vec_sub((lx2, ly2), (lx1, ly1))
            return [
                mx - foot[0], my - foot[1],
                vec_dot(d_ab, d_line),
            ]
        if ref.type == EntityType.POINT:
            px, py = dm.point_xy(x, ref.id, 0)
            return [
                (ax + bx) / 2.0 - px,
                (ay + by) / 2.0 - py,
            ]

    # Fallback: symmetric about origin
    return [(ax + bx) / 2.0, (ay + by) / 2.0]


def _err_fixed(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    """Fixed constraint: entity DOFs should not change from initial values.

    The initial values are stored as the *reference* in the constraint's
    value field (we re-derive them from the entity_order pack at build time,
    handled via the fixed_ids set).
    """
    # Handled via bounds/fixed masking in the solver loop — returning empty
    # keeps the residual clean.  The solver already excludes fixed DOFs.
    return []


def _err_midpoint(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    """Point lies at the midpoint of a line segment."""
    pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
    px, py = dm.point_xy(x, c.entity_ids[0], pi0)
    (lx1, ly1), (lx2, ly2) = dm.line_endpoints(x, c.entity_ids[1])
    return [px - (lx1 + lx2) / 2.0, py - (ly1 + ly2) / 2.0]


def _err_collinear(
    x: np.ndarray, dm: _DOFMap, c: Constraint, _p: Dict[str, float],
) -> List[float]:
    """Two lines are collinear (same infinite line)."""
    (ax1, ay1), (ax2, ay2) = dm.line_endpoints(x, c.entity_ids[0])
    (bx1, by1), (bx2, by2) = dm.line_endpoints(x, c.entity_ids[1])
    da = (ax2 - ax1, ay2 - ay1)
    # Both endpoints of line B must lie on line A
    fb1 = (bx1 - ax1, by1 - ay1)
    fb2 = (bx2 - ax1, by2 - ay1)
    return [
        da[0] * fb1[1] - da[1] * fb1[0],
        da[0] * fb2[1] - da[1] * fb2[0],
    ]


def _err_distance(
    x: np.ndarray, dm: _DOFMap, c: Constraint, params: Dict[str, float],
) -> List[float]:
    target = _resolve_value(c.value, params)
    if target is None:
        return [0.0]

    if len(c.entity_ids) == 1:
        e = dm._entity(c.entity_ids[0])
        if e.type == EntityType.LINE:
            (lx1, ly1), (lx2, ly2) = dm.line_endpoints(x, e.id)
            return [math.hypot(lx2 - lx1, ly2 - ly1) - target]
    if len(c.entity_ids) >= 2:
        pi0 = c.point_indices[0] if len(c.point_indices) > 0 else None
        pi1 = c.point_indices[1] if len(c.point_indices) > 1 else None
        ax, ay = dm.point_xy(x, c.entity_ids[0], pi0)
        bx, by = dm.point_xy(x, c.entity_ids[1], pi1)
        return [math.hypot(bx - ax, by - ay) - target]
    return [0.0]


def _err_angle(
    x: np.ndarray, dm: _DOFMap, c: Constraint, params: Dict[str, float],
) -> List[float]:
    target = _resolve_value(c.value, params)
    if target is None:
        return [0.0]
    target_rad = math.radians(target)

    (ax1, ay1), (ax2, ay2) = dm.line_endpoints(x, c.entity_ids[0])
    if len(c.entity_ids) >= 2:
        (bx1, by1), (bx2, by2) = dm.line_endpoints(x, c.entity_ids[1])
    else:
        # Angle to horizontal
        (bx1, by1), (bx2, by2) = (0.0, 0.0), (1.0, 0.0)

    da = vec_normalize((ax2 - ax1, ay2 - ay1))
    db = vec_normalize((bx2 - bx1, by2 - by1))
    dot = max(-1.0, min(1.0, vec_dot(da, db)))
    current = math.acos(abs(dot))
    return [current - target_rad]


def _err_radius(
    x: np.ndarray, dm: _DOFMap, c: Constraint, params: Dict[str, float],
) -> List[float]:
    target = _resolve_value(c.value, params)
    if target is None:
        return [0.0]
    e = dm._entity(c.entity_ids[0])
    if e.type == EntityType.CIRCLE:
        _, _, r = dm.circle_params(x, e.id)
        return [r - target]
    if e.type == EntityType.ARC:
        _, _, r, *_ = dm.arc_params(x, e.id)
        return [r - target]
    return [0.0]


# Dispatch table
_CONSTRAINT_FN: Dict[ConstraintType, ErrorFn] = {
    ConstraintType.COINCIDENT: _err_coincident,
    ConstraintType.HORIZONTAL: _err_horizontal,
    ConstraintType.VERTICAL: _err_vertical,
    ConstraintType.PARALLEL: _err_parallel,
    ConstraintType.PERPENDICULAR: _err_perpendicular,
    ConstraintType.TANGENT: _err_tangent,
    ConstraintType.CONCENTRIC: _err_concentric,
    ConstraintType.EQUAL: _err_equal,
    ConstraintType.SYMMETRIC: _err_symmetric,
    ConstraintType.FIXED: _err_fixed,
    ConstraintType.MIDPOINT: _err_midpoint,
    ConstraintType.COLLINEAR: _err_collinear,
    ConstraintType.DISTANCE: _err_distance,
    ConstraintType.ANGLE: _err_angle,
    ConstraintType.RADIUS: _err_radius,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_value(
    value: Optional[float], params: Dict[str, float],
) -> Optional[float]:
    """If *value* is not None return it; otherwise return None."""
    return value


def _count_constraint_equations(
    constraints: List[Constraint], dm: _DOFMap,
) -> int:
    """Estimate the number of scalar equations from all constraints."""
    x0 = dm.pack_all()
    total = 0
    for c in constraints:
        fn = _CONSTRAINT_FN.get(c.type)
        if fn is not None:
            total += len(fn(x0, dm, c, {}))
    return total


# ---------------------------------------------------------------------------
# Public solver entry-point
# ---------------------------------------------------------------------------

def solve(
    sketch: Sketch,
    *,
    max_iterations: int = 500,
    tolerance: float = 1e-10,
) -> SolveResult:
    """Solve all constraints on *sketch* **in place**.

    Returns a :class:`SolveResult` with diagnostics.
    """
    if not sketch.entities:
        return SolveResult(success=True, status="No entities")

    # Evaluate parameters
    try:
        params = evaluate_parameters(sketch.parameters)
    except ValueError as exc:
        return SolveResult(success=False, status=f"Parameter error: {exc}")

    # Identify fixed entities
    fixed_ids: Set[str] = set()
    for c in sketch.constraints:
        if c.type == ConstraintType.FIXED:
            fixed_ids.update(c.entity_ids)

    dm = _DOFMap(sketch, fixed_ids)

    if dm.total_dof == 0:
        return SolveResult(success=True, dof=0, status="Nothing to solve")

    x0 = dm.pack_all()
    x0_initial = x0.copy()

    # Build mask of free DOFs (not fixed)
    free_mask = np.ones(dm.total_dof, dtype=bool)
    for eid in fixed_ids:
        off = dm.id_to_offset[eid]
        cnt = dm.id_to_count[eid]
        free_mask[off: off + cnt] = False
    free_indices = np.where(free_mask)[0]
    n_free = len(free_indices)

    if n_free == 0:
        return SolveResult(success=True, dof=0, status="Fully fixed")

    # Count constraint equations
    active_constraints = [
        c for c in sketch.constraints if c.type != ConstraintType.FIXED
    ]
    n_equations = _count_constraint_equations(active_constraints, dm)

    # --- objective ---
    def objective(x_free: np.ndarray) -> float:
        x_full = x0_initial.copy()
        x_full[free_indices] = x_free
        total = 0.0
        for con in active_constraints:
            fn = _CONSTRAINT_FN.get(con.type)
            if fn is None:
                continue
            for e in fn(x_full, dm, con, params):
                total += e * e
        return total

    def gradient(x_free: np.ndarray) -> np.ndarray:
        """Numerical gradient via central differences."""
        grad = np.zeros_like(x_free)
        h = 1e-7
        f0 = objective(x_free)
        for i in range(len(x_free)):
            x_free[i] += h
            f1 = objective(x_free)
            x_free[i] -= h
            grad[i] = (f1 - f0) / h
        return grad

    x_free_init = x0[free_indices].copy()

    result = minimize(
        objective,
        x_free_init,
        method="L-BFGS-B",
        jac=gradient,
        options={"maxiter": max_iterations, "ftol": tolerance, "gtol": 1e-8},
    )

    # Write solution back
    x_final = x0_initial.copy()
    x_final[free_indices] = result.x
    dm.unpack_all(x_final)

    residual = float(result.fun)
    solved = residual < tolerance * 100

    # DOF analysis
    dof = n_free - n_equations
    over_constrained = dof < 0
    under_constrained = dof > 0

    status_parts: List[str] = []
    if solved:
        status_parts.append("Solved")
    else:
        status_parts.append(f"Residual {residual:.2e}")
    if over_constrained:
        status_parts.append(f"over-constrained (DOF={dof})")
    elif under_constrained:
        status_parts.append(f"under-constrained (DOF={dof})")
    else:
        status_parts.append(f"well-constrained (DOF={dof})")

    return SolveResult(
        success=solved,
        residual=residual,
        iterations=result.nit,
        dof=dof,
        status="; ".join(status_parts),
        over_constrained=over_constrained,
        under_constrained=under_constrained,
    )


def compute_dof(sketch: Sketch) -> int:
    """Return the current degrees of freedom without solving.

    DOF = total free scalar DOFs - number of constraint equations.
    """
    if not sketch.entities:
        return 0

    fixed_ids: Set[str] = set()
    for c in sketch.constraints:
        if c.type == ConstraintType.FIXED:
            fixed_ids.update(c.entity_ids)

    dm = _DOFMap(sketch, fixed_ids)

    free_count = 0
    for e in sketch.entities:
        if e.id not in fixed_ids:
            free_count += _entity_dof_count(e)

    active_constraints = [
        c for c in sketch.constraints if c.type != ConstraintType.FIXED
    ]
    n_equations = _count_constraint_equations(active_constraints, dm)
    return free_count - n_equations
