"""
2-D geometry utility functions.

All angles are in **radians** unless stated otherwise.
Points are represented as (x, y) tuples or pairs of floats.
"""

from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------
Vec2 = Tuple[float, float]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TWO_PI = 2.0 * math.pi
EPSILON = 1e-12


# ===================================================================
# Basic vector / point helpers
# ===================================================================

def vec_add(a: Vec2, b: Vec2) -> Vec2:
    return (a[0] + b[0], a[1] + b[1])


def vec_sub(a: Vec2, b: Vec2) -> Vec2:
    return (a[0] - b[0], a[1] - b[1])


def vec_scale(v: Vec2, s: float) -> Vec2:
    return (v[0] * s, v[1] * s)


def vec_dot(a: Vec2, b: Vec2) -> float:
    return a[0] * b[0] + a[1] * b[1]


def vec_cross(a: Vec2, b: Vec2) -> float:
    """2-D cross product (scalar z-component)."""
    return a[0] * b[1] - a[1] * b[0]


def vec_length(v: Vec2) -> float:
    return math.hypot(v[0], v[1])


def vec_normalize(v: Vec2) -> Vec2:
    length = vec_length(v)
    if length < EPSILON:
        return (0.0, 0.0)
    return (v[0] / length, v[1] / length)


def vec_perpendicular(v: Vec2) -> Vec2:
    """Return a vector rotated 90 degrees counter-clockwise."""
    return (-v[1], v[0])


# ===================================================================
# Point / distance
# ===================================================================

def point_distance(p1: Vec2, p2: Vec2) -> float:
    """Euclidean distance between two points."""
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])


def point_distance_squared(p1: Vec2, p2: Vec2) -> float:
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return dx * dx + dy * dy


def midpoint(p1: Vec2, p2: Vec2) -> Vec2:
    return ((p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0)


def lerp(p1: Vec2, p2: Vec2, t: float) -> Vec2:
    """Linear interpolation between *p1* and *p2* at parameter *t*."""
    return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))


# ===================================================================
# Line utilities
# ===================================================================

def line_direction(p1: Vec2, p2: Vec2) -> Vec2:
    return vec_normalize(vec_sub(p2, p1))


def line_length(p1: Vec2, p2: Vec2) -> float:
    return point_distance(p1, p2)


def point_to_line_distance(point: Vec2, line_p1: Vec2, line_p2: Vec2) -> float:
    """Signed perpendicular distance from *point* to the infinite line
    through *line_p1* and *line_p2*."""
    d = vec_sub(line_p2, line_p1)
    length = vec_length(d)
    if length < EPSILON:
        return point_distance(point, line_p1)
    return vec_cross(d, vec_sub(point, line_p1)) / length


def nearest_point_on_line(point: Vec2, line_p1: Vec2, line_p2: Vec2,
                          clamp: bool = False) -> Vec2:
    """Project *point* onto the infinite line (or segment if *clamp*).

    Returns the closest point on the line / segment.
    """
    d = vec_sub(line_p2, line_p1)
    len_sq = vec_dot(d, d)
    if len_sq < EPSILON:
        return line_p1
    t = vec_dot(vec_sub(point, line_p1), d) / len_sq
    if clamp:
        t = max(0.0, min(1.0, t))
    return vec_add(line_p1, vec_scale(d, t))


def nearest_point_on_segment(point: Vec2, seg_p1: Vec2, seg_p2: Vec2) -> Vec2:
    """Closest point on the *closed* segment [seg_p1, seg_p2]."""
    return nearest_point_on_line(point, seg_p1, seg_p2, clamp=True)


def line_line_intersection(
    p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2
) -> Optional[Vec2]:
    """Intersection of two infinite lines (p1-p2) and (p3-p4).

    Returns ``None`` if the lines are parallel.
    """
    d1 = vec_sub(p2, p1)
    d2 = vec_sub(p4, p3)
    denom = vec_cross(d1, d2)
    if abs(denom) < EPSILON:
        return None
    t = vec_cross(vec_sub(p3, p1), d2) / denom
    return vec_add(p1, vec_scale(d1, t))


def segment_segment_intersection(
    p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2
) -> Optional[Vec2]:
    """Intersection of two finite segments.  Returns ``None`` if they
    do not intersect."""
    d1 = vec_sub(p2, p1)
    d2 = vec_sub(p4, p3)
    denom = vec_cross(d1, d2)
    if abs(denom) < EPSILON:
        return None
    dp = vec_sub(p3, p1)
    t = vec_cross(dp, d2) / denom
    u = vec_cross(dp, d1) / denom
    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        return vec_add(p1, vec_scale(d1, t))
    return None


# ===================================================================
# Circle utilities
# ===================================================================

def point_on_circle(center: Vec2, radius: float, angle: float) -> Vec2:
    return (center[0] + radius * math.cos(angle),
            center[1] + radius * math.sin(angle))


def nearest_point_on_circle(point: Vec2, center: Vec2,
                            radius: float) -> Vec2:
    d = vec_sub(point, center)
    length = vec_length(d)
    if length < EPSILON:
        return (center[0] + radius, center[1])
    scale = radius / length
    return vec_add(center, vec_scale(d, scale))


def circle_line_intersection(
    center: Vec2, radius: float,
    line_p1: Vec2, line_p2: Vec2,
) -> List[Vec2]:
    """Return 0, 1, or 2 intersection points of a circle and an
    infinite line."""
    d = vec_sub(line_p2, line_p1)
    f = vec_sub(line_p1, center)
    a = vec_dot(d, d)
    b = 2.0 * vec_dot(f, d)
    c = vec_dot(f, f) - radius * radius
    discriminant = b * b - 4.0 * a * c
    if discriminant < -EPSILON:
        return []
    if a < EPSILON:
        return []
    results: List[Vec2] = []
    if discriminant < EPSILON:
        t = -b / (2.0 * a)
        results.append(vec_add(line_p1, vec_scale(d, t)))
    else:
        sq = math.sqrt(discriminant)
        t1 = (-b - sq) / (2.0 * a)
        t2 = (-b + sq) / (2.0 * a)
        results.append(vec_add(line_p1, vec_scale(d, t1)))
        results.append(vec_add(line_p1, vec_scale(d, t2)))
    return results


def circle_circle_intersection(
    c1: Vec2, r1: float, c2: Vec2, r2: float,
) -> List[Vec2]:
    """Return 0, 1, or 2 intersection points of two circles."""
    d = point_distance(c1, c2)
    if d > r1 + r2 + EPSILON or d < abs(r1 - r2) - EPSILON or d < EPSILON:
        return []
    a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d)
    h_sq = r1 * r1 - a * a
    if h_sq < 0.0:
        h_sq = 0.0
    h = math.sqrt(h_sq)
    dx = (c2[0] - c1[0]) / d
    dy = (c2[1] - c1[1]) / d
    mx = c1[0] + a * dx
    my = c1[1] + a * dy
    if h < EPSILON:
        return [(mx, my)]
    return [
        (mx + h * dy, my - h * dx),
        (mx - h * dy, my + h * dx),
    ]


# ===================================================================
# Arc utilities
# ===================================================================

def normalize_angle(a: float) -> float:
    """Map angle into [0, 2*pi)."""
    a = a % TWO_PI
    if a < 0.0:
        a += TWO_PI
    return a


def angle_between(start: float, end: float) -> float:
    """Swept angle from *start* to *end* going counter-clockwise."""
    d = normalize_angle(end - start)
    return d if d > 0.0 else TWO_PI


def arc_start_point(cx: float, cy: float, radius: float,
                    start_angle: float) -> Vec2:
    return point_on_circle((cx, cy), radius, start_angle)


def arc_end_point(cx: float, cy: float, radius: float,
                  end_angle: float) -> Vec2:
    return point_on_circle((cx, cy), radius, end_angle)


def arc_midpoint(cx: float, cy: float, radius: float,
                 start_angle: float, end_angle: float) -> Vec2:
    mid_angle = start_angle + angle_between(start_angle, end_angle) / 2.0
    return point_on_circle((cx, cy), radius, mid_angle)


def point_on_arc(cx: float, cy: float, radius: float,
                 start_angle: float, end_angle: float,
                 px: float, py: float, tolerance: float = 1e-9) -> bool:
    """Return True if (px, py) lies on the arc within *tolerance*."""
    dist = point_distance((px, py), (cx, cy))
    if abs(dist - radius) > tolerance:
        return False
    a = normalize_angle(math.atan2(py - cy, px - cx))
    sa = normalize_angle(start_angle)
    sweep = angle_between(sa, normalize_angle(end_angle))
    da = normalize_angle(a - sa)
    return da <= sweep + tolerance


def nearest_point_on_arc(
    point: Vec2, cx: float, cy: float, radius: float,
    start_angle: float, end_angle: float,
) -> Vec2:
    """Closest point on the arc to the given *point*."""
    a = math.atan2(point[1] - cy, point[0] - cx)
    sa = normalize_angle(start_angle)
    sweep = angle_between(sa, normalize_angle(end_angle))
    da = normalize_angle(a - sa)
    if da <= sweep:
        return point_on_circle((cx, cy), radius, a)
    # Clamp to nearer endpoint
    sp = arc_start_point(cx, cy, radius, start_angle)
    ep = arc_end_point(cx, cy, radius, end_angle)
    if point_distance_squared(point, sp) <= point_distance_squared(point, ep):
        return sp
    return ep


# ===================================================================
# Bezier / Spline evaluation
# ===================================================================

def _bernstein(n: int, i: int, t: float) -> float:
    """Bernstein basis polynomial."""
    from math import comb
    return comb(n, i) * (t ** i) * ((1.0 - t) ** (n - i))


def bezier_point(control_points: Sequence[Vec2], t: float) -> Vec2:
    """Evaluate a Bezier curve of arbitrary degree at parameter *t*."""
    n = len(control_points) - 1
    x = 0.0
    y = 0.0
    for i, cp in enumerate(control_points):
        b = _bernstein(n, i, t)
        x += b * cp[0]
        y += b * cp[1]
    return (x, y)


def bezier_derivative(control_points: Sequence[Vec2], t: float) -> Vec2:
    """First derivative of a Bezier curve at *t*."""
    n = len(control_points) - 1
    if n < 1:
        return (0.0, 0.0)
    dpts = [
        ((control_points[i + 1][0] - control_points[i][0]) * n,
         (control_points[i + 1][1] - control_points[i][1]) * n)
        for i in range(n)
    ]
    return bezier_point(dpts, t)


def de_casteljau(control_points: Sequence[Vec2], t: float) -> Vec2:
    """De Casteljau evaluation (numerically stable)."""
    pts = list(control_points)
    n = len(pts)
    for r in range(1, n):
        pts = [lerp(pts[i], pts[i + 1], t) for i in range(n - r)]
    return pts[0]


def cubic_spline_evaluate(
    control_points: Sequence[Vec2], t: float,
) -> Vec2:
    """Evaluate a natural cubic spline through *control_points*.

    Uses a piecewise Catmull-Rom approach for simplicity.
    *t* in [0, 1] maps over the entire spline.
    """
    n = len(control_points)
    if n == 0:
        return (0.0, 0.0)
    if n == 1:
        return control_points[0]
    if n == 2:
        return lerp(control_points[0], control_points[1], t)

    segments = n - 1
    scaled = t * segments
    seg = int(scaled)
    seg = min(seg, segments - 1)
    local_t = scaled - seg

    p0 = control_points[max(seg - 1, 0)]
    p1 = control_points[seg]
    p2 = control_points[min(seg + 1, n - 1)]
    p3 = control_points[min(seg + 2, n - 1)]

    # Catmull-Rom
    tt = local_t
    tt2 = tt * tt
    tt3 = tt2 * tt

    def _cr(a: float, b: float, c: float, d: float) -> float:
        return 0.5 * (
            (2.0 * b)
            + (-a + c) * tt
            + (2.0 * a - 5.0 * b + 4.0 * c - d) * tt2
            + (-a + 3.0 * b - 3.0 * c + d) * tt3
        )

    return (_cr(p0[0], p1[0], p2[0], p3[0]),
            _cr(p0[1], p1[1], p2[1], p3[1]))


# ===================================================================
# Fillet / Chamfer
# ===================================================================

def fillet_arc(
    line1_p1: Vec2, line1_p2: Vec2,
    line2_p1: Vec2, line2_p2: Vec2,
    radius: float,
) -> Optional[Tuple[Vec2, Vec2, Vec2, float, float]]:
    """Compute a fillet arc between two line segments that share an endpoint
    (or whose infinite lines intersect).

    Returns ``(center, start_tangent_point, end_tangent_point,
    start_angle, end_angle)`` or ``None`` if the lines are parallel.
    """
    corner = line_line_intersection(line1_p1, line1_p2, line2_p1, line2_p2)
    if corner is None:
        return None

    d1 = vec_normalize(vec_sub(line1_p2, line1_p1))
    d2 = vec_normalize(vec_sub(line2_p2, line2_p1))

    bisector = vec_normalize(vec_add(d1, d2))
    half_angle = math.acos(max(-1.0, min(1.0, abs(vec_dot(d1, d2)))))
    if abs(math.sin(half_angle)) < EPSILON:
        return None
    dist_to_center = radius / math.sin(half_angle)

    # Determine which side
    cross = vec_cross(d1, d2)
    n1 = vec_perpendicular(d1)
    if cross < 0:
        n1 = vec_scale(n1, -1.0)

    center = vec_add(corner, vec_scale(
        vec_normalize(vec_add(n1, vec_perpendicular(d2) if cross >= 0
                              else vec_scale(vec_perpendicular(d2), -1.0))),
        dist_to_center,
    ))

    tp1 = nearest_point_on_line(center, line1_p1, line1_p2)
    tp2 = nearest_point_on_line(center, line2_p1, line2_p2)

    sa = math.atan2(tp1[1] - center[1], tp1[0] - center[0])
    ea = math.atan2(tp2[1] - center[1], tp2[0] - center[0])

    return (center, tp1, tp2, sa, ea)


def chamfer_points(
    line1_p1: Vec2, line1_p2: Vec2,
    line2_p1: Vec2, line2_p2: Vec2,
    dist1: float, dist2: Optional[float] = None,
) -> Optional[Tuple[Vec2, Vec2]]:
    """Compute the two trim points for a chamfer between two lines.

    *dist1* is the distance along line1 from the corner and *dist2* along
    line2 (defaults to *dist1* for a symmetric chamfer).
    """
    if dist2 is None:
        dist2 = dist1
    corner = line_line_intersection(line1_p1, line1_p2, line2_p1, line2_p2)
    if corner is None:
        return None
    d1 = vec_normalize(vec_sub(line1_p1, corner))
    d2 = vec_normalize(vec_sub(line2_p1, corner))
    # If the directions point away from corner, flip them to point along the
    # segments away from corner.  We want the trimmed endpoints.
    cp1 = vec_add(corner, vec_scale(
        vec_normalize(vec_sub(line1_p2, corner)), dist1))
    cp2 = vec_add(corner, vec_scale(
        vec_normalize(vec_sub(line2_p2, corner)), dist2))
    return (cp1, cp2)


# ===================================================================
# Offset curves
# ===================================================================

def offset_line(p1: Vec2, p2: Vec2, distance: float) -> Tuple[Vec2, Vec2]:
    """Offset an infinite line by *distance* (positive = left side)."""
    d = vec_normalize(vec_sub(p2, p1))
    n = vec_perpendicular(d)
    off = vec_scale(n, distance)
    return (vec_add(p1, off), vec_add(p2, off))


def offset_circle(center: Vec2, radius: float,
                  distance: float) -> Tuple[Vec2, float]:
    """Offset a circle.  Positive *distance* grows outward."""
    new_r = radius + distance
    if new_r < 0.0:
        new_r = 0.0
    return (center, new_r)


def offset_polyline(
    points: Sequence[Vec2], distance: float, closed: bool = False,
) -> List[Vec2]:
    """Offset a polyline by *distance*.  Uses simple miter joins.

    Positive distance = left-hand side.
    """
    n = len(points)
    if n < 2:
        return list(points)

    normals: List[Vec2] = []
    for i in range(n - 1):
        d = vec_normalize(vec_sub(points[i + 1], points[i]))
        normals.append(vec_perpendicular(d))
    if closed:
        d = vec_normalize(vec_sub(points[0], points[-1]))
        normals.append(vec_perpendicular(d))

    result: List[Vec2] = []
    for i in range(n):
        if closed:
            n1 = normals[(i - 1) % len(normals)]
            n2 = normals[i % len(normals)]
        else:
            if i == 0:
                n1 = n2 = normals[0]
            elif i == n - 1:
                n1 = n2 = normals[-1]
            else:
                n1 = normals[i - 1]
                n2 = normals[i]
        bisector = vec_normalize(vec_add(n1, n2))
        cos_half = vec_dot(bisector, n1)
        if abs(cos_half) < EPSILON:
            cos_half = EPSILON
        offset_vec = vec_scale(bisector, distance / cos_half)
        result.append(vec_add(points[i], offset_vec))
    return result


# ===================================================================
# Transformations
# ===================================================================

def rotate_point(point: Vec2, center: Vec2, angle: float) -> Vec2:
    """Rotate *point* around *center* by *angle* (radians, CCW)."""
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    dx = point[0] - center[0]
    dy = point[1] - center[1]
    return (center[0] + dx * cos_a - dy * sin_a,
            center[1] + dx * sin_a + dy * cos_a)


def mirror_point(point: Vec2, axis_p1: Vec2, axis_p2: Vec2) -> Vec2:
    """Mirror *point* across the line defined by *axis_p1* and *axis_p2*."""
    foot = nearest_point_on_line(point, axis_p1, axis_p2)
    return (2.0 * foot[0] - point[0], 2.0 * foot[1] - point[1])


def scale_point(point: Vec2, center: Vec2, factor: float) -> Vec2:
    """Scale *point* relative to *center*."""
    return (center[0] + (point[0] - center[0]) * factor,
            center[1] + (point[1] - center[1]) * factor)


def rotate_points(points: Sequence[Vec2], center: Vec2,
                  angle: float) -> List[Vec2]:
    return [rotate_point(p, center, angle) for p in points]


def mirror_points(points: Sequence[Vec2], axis_p1: Vec2,
                  axis_p2: Vec2) -> List[Vec2]:
    return [mirror_point(p, axis_p1, axis_p2) for p in points]


def scale_points(points: Sequence[Vec2], center: Vec2,
                 factor: float) -> List[Vec2]:
    return [scale_point(p, center, factor) for p in points]


# ===================================================================
# Angle helpers
# ===================================================================

def angle_of_line(p1: Vec2, p2: Vec2) -> float:
    """Angle (radians) of the directed line p1 -> p2."""
    return math.atan2(p2[1] - p1[1], p2[0] - p1[0])


def angle_between_lines(
    a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2,
) -> float:
    """Unsigned angle between two directed lines (0..pi)."""
    da = vec_normalize(vec_sub(a2, a1))
    db = vec_normalize(vec_sub(b2, b1))
    dot = max(-1.0, min(1.0, vec_dot(da, db)))
    return math.acos(abs(dot))
