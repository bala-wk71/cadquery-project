"""
JSON-serializable data model for a parametric 2D sketch.

Defines entities (Point, Line, Circle, Arc, Ellipse, Rectangle, Polygon,
Spline, Polyline), constraints, parameters, layers, and the top-level
Sketch container.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Type


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class EntityType(str, Enum):
    POINT = "point"
    LINE = "line"
    CIRCLE = "circle"
    ARC = "arc"
    ELLIPSE = "ellipse"
    RECTANGLE = "rectangle"
    POLYGON = "polygon"
    SPLINE = "spline"
    POLYLINE = "polyline"


class ConstraintType(str, Enum):
    COINCIDENT = "coincident"
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"
    PARALLEL = "parallel"
    PERPENDICULAR = "perpendicular"
    TANGENT = "tangent"
    CONCENTRIC = "concentric"
    EQUAL = "equal"
    SYMMETRIC = "symmetric"
    FIXED = "fixed"
    MIDPOINT = "midpoint"
    COLLINEAR = "collinear"
    DISTANCE = "distance"
    ANGLE = "angle"
    RADIUS = "radius"


class LineStyle(str, Enum):
    SOLID = "solid"
    DASHED = "dashed"
    DOTTED = "dotted"
    DASHDOT = "dashdot"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _new_id() -> str:
    """Return a short unique identifier."""
    return uuid.uuid4().hex[:12]


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------

@dataclass
class Entity:
    """Base for every sketch entity."""
    id: str = field(default_factory=_new_id)
    type: EntityType = EntityType.POINT
    layer: Optional[str] = None
    construction: bool = False

    # Subclasses override these two
    def _geometry_dict(self) -> Dict[str, Any]:
        return {}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Entity":
        return cls()

    # Serialisation
    def to_dict(self) -> Dict[str, Any]:
        base: Dict[str, Any] = {
            "id": self.id,
            "type": self.type.value,
            "layer": self.layer,
            "construction": self.construction,
        }
        base.update(self._geometry_dict())
        return base

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Entity":
        etype = EntityType(d["type"])
        cls = _ENTITY_REGISTRY[etype]
        obj = cls._from_geometry_dict(d)
        obj.id = d.get("id", _new_id())
        obj.type = etype
        obj.layer = d.get("layer")
        obj.construction = d.get("construction", False)
        return obj


@dataclass
class Point(Entity):
    x: float = 0.0
    y: float = 0.0
    type: EntityType = field(default=EntityType.POINT, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {"x": self.x, "y": self.y}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Point":
        return cls(x=d["x"], y=d["y"])


@dataclass
class Line(Entity):
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 1.0
    y2: float = 0.0
    type: EntityType = field(default=EntityType.LINE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Line":
        return cls(x1=d["x1"], y1=d["y1"], x2=d["x2"], y2=d["y2"])


@dataclass
class Circle(Entity):
    cx: float = 0.0
    cy: float = 0.0
    radius: float = 1.0
    type: EntityType = field(default=EntityType.CIRCLE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {"cx": self.cx, "cy": self.cy, "radius": self.radius}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Circle":
        return cls(cx=d["cx"], cy=d["cy"], radius=d["radius"])


@dataclass
class Arc(Entity):
    cx: float = 0.0
    cy: float = 0.0
    radius: float = 1.0
    start_angle: float = 0.0
    end_angle: float = 90.0
    type: EntityType = field(default=EntityType.ARC, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {
            "cx": self.cx, "cy": self.cy, "radius": self.radius,
            "start_angle": self.start_angle, "end_angle": self.end_angle,
        }

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Arc":
        return cls(
            cx=d["cx"], cy=d["cy"], radius=d["radius"],
            start_angle=d["start_angle"], end_angle=d["end_angle"],
        )


@dataclass
class Ellipse(Entity):
    cx: float = 0.0
    cy: float = 0.0
    rx: float = 2.0
    ry: float = 1.0
    rotation: float = 0.0
    type: EntityType = field(default=EntityType.ELLIPSE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {
            "cx": self.cx, "cy": self.cy,
            "rx": self.rx, "ry": self.ry,
            "rotation": self.rotation,
        }

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Ellipse":
        return cls(
            cx=d["cx"], cy=d["cy"],
            rx=d["rx"], ry=d["ry"],
            rotation=d.get("rotation", 0.0),
        )


@dataclass
class Rectangle(Entity):
    x: float = 0.0
    y: float = 0.0
    width: float = 1.0
    height: float = 1.0
    rotation: float = 0.0
    type: EntityType = field(default=EntityType.RECTANGLE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {
            "x": self.x, "y": self.y,
            "width": self.width, "height": self.height,
            "rotation": self.rotation,
        }

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Rectangle":
        return cls(
            x=d["x"], y=d["y"],
            width=d["width"], height=d["height"],
            rotation=d.get("rotation", 0.0),
        )


@dataclass
class Polygon(Entity):
    """Closed polygon defined by an ordered list of vertices."""
    vertices: List[Tuple[float, float]] = field(default_factory=list)
    type: EntityType = field(default=EntityType.POLYGON, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {"vertices": [list(v) for v in self.vertices]}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Polygon":
        return cls(vertices=[tuple(v) for v in d["vertices"]])


@dataclass
class Spline(Entity):
    """Cubic spline through control points."""
    control_points: List[Tuple[float, float]] = field(default_factory=list)
    degree: int = 3
    type: EntityType = field(default=EntityType.SPLINE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {
            "control_points": [list(p) for p in self.control_points],
            "degree": self.degree,
        }

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Spline":
        return cls(
            control_points=[tuple(p) for p in d["control_points"]],
            degree=d.get("degree", 3),
        )


@dataclass
class Polyline(Entity):
    """Open polyline (non-closed sequence of line segments)."""
    points: List[Tuple[float, float]] = field(default_factory=list)
    type: EntityType = field(default=EntityType.POLYLINE, init=False, repr=False)

    def _geometry_dict(self) -> Dict[str, Any]:
        return {"points": [list(p) for p in self.points]}

    @classmethod
    def _from_geometry_dict(cls, d: Dict[str, Any]) -> "Polyline":
        return cls(points=[tuple(p) for p in d["points"]])


_ENTITY_REGISTRY: Dict[EntityType, Type[Entity]] = {
    EntityType.POINT: Point,
    EntityType.LINE: Line,
    EntityType.CIRCLE: Circle,
    EntityType.ARC: Arc,
    EntityType.ELLIPSE: Ellipse,
    EntityType.RECTANGLE: Rectangle,
    EntityType.POLYGON: Polygon,
    EntityType.SPLINE: Spline,
    EntityType.POLYLINE: Polyline,
}


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

@dataclass
class Constraint:
    """A geometric or dimensional constraint between entities."""
    id: str = field(default_factory=_new_id)
    type: ConstraintType = ConstraintType.COINCIDENT
    entity_ids: List[str] = field(default_factory=list)
    point_indices: List[Optional[int]] = field(default_factory=list)
    value: Optional[float] = None
    reference_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "entity_ids": list(self.entity_ids),
            "point_indices": list(self.point_indices),
            "value": self.value,
            "reference_id": self.reference_id,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Constraint":
        return cls(
            id=d.get("id", _new_id()),
            type=ConstraintType(d["type"]),
            entity_ids=d.get("entity_ids", []),
            point_indices=d.get("point_indices", []),
            value=d.get("value"),
            reference_id=d.get("reference_id"),
        )


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

@dataclass
class Parameter:
    """
    A named variable whose *expression* can reference other parameters.

    Examples:
        Parameter(name="width", expression="50")
        Parameter(name="height", expression="width * 2")
    """
    name: str = ""
    expression: str = "0"
    comment: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "expression": self.expression,
            "comment": self.comment,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Parameter":
        return cls(
            name=d["name"],
            expression=d["expression"],
            comment=d.get("comment", ""),
        )


# ---------------------------------------------------------------------------
# Layer
# ---------------------------------------------------------------------------

@dataclass
class Layer:
    name: str = "Default"
    color: str = "#000000"
    line_style: LineStyle = LineStyle.SOLID
    visible: bool = True
    locked: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "color": self.color,
            "line_style": self.line_style.value,
            "visible": self.visible,
            "locked": self.locked,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Layer":
        return cls(
            name=d["name"],
            color=d.get("color", "#000000"),
            line_style=LineStyle(d.get("line_style", "solid")),
            visible=d.get("visible", True),
            locked=d.get("locked", False),
        )


# ---------------------------------------------------------------------------
# Sketch (top-level container)
# ---------------------------------------------------------------------------

@dataclass
class Sketch:
    """
    Top-level container holding every element of a 2-D parametric sketch.
    Fully round-trip serialisable to / from a JSON-compatible dict.
    """
    name: str = "Untitled"
    entities: List[Entity] = field(default_factory=list)
    constraints: List[Constraint] = field(default_factory=list)
    parameters: List[Parameter] = field(default_factory=list)
    layers: List[Layer] = field(default_factory=list)

    # -- convenience lookups ------------------------------------------------

    def entity_by_id(self, eid: str) -> Optional[Entity]:
        for e in self.entities:
            if e.id == eid:
                return e
        return None

    def constraint_by_id(self, cid: str) -> Optional[Constraint]:
        for c in self.constraints:
            if c.id == cid:
                return c
        return None

    def parameter_by_name(self, name: str) -> Optional[Parameter]:
        for p in self.parameters:
            if p.name == name:
                return p
        return None

    # -- serialisation ------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "entities": [e.to_dict() for e in self.entities],
            "constraints": [c.to_dict() for c in self.constraints],
            "parameters": [p.to_dict() for p in self.parameters],
            "layers": [l.to_dict() for l in self.layers],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Sketch":
        return cls(
            name=d.get("name", "Untitled"),
            entities=[Entity.from_dict(e) for e in d.get("entities", [])],
            constraints=[Constraint.from_dict(c) for c in d.get("constraints", [])],
            parameters=[Parameter.from_dict(p) for p in d.get("parameters", [])],
            layers=[Layer.from_dict(l) for l in d.get("layers", [])],
        )
