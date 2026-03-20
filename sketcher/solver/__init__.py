"""
solver — Parametric 2-D sketch constraint solver.

Public API
----------
Data model
    Sketch, Entity, Point, Line, Circle, Arc, Ellipse, Rectangle,
    Polygon, Spline, Polyline, Constraint, Parameter, Layer,
    EntityType, ConstraintType, LineStyle

Geometry utilities
    geometry module (imported as ``solver.geometry``)

Solver
    solve, compute_dof, SolveResult, evaluate_parameters
"""

from .sketch_model import (
    Arc,
    Circle,
    Constraint,
    ConstraintType,
    Ellipse,
    Entity,
    EntityType,
    Layer,
    Line,
    LineStyle,
    Parameter,
    Point,
    Polygon,
    Polyline,
    Rectangle,
    Sketch,
    Spline,
)

from .constraint_solver import (
    SolveResult,
    compute_dof,
    evaluate_parameters,
    solve,
)

from . import geometry

__all__ = [
    # Model
    "Arc", "Circle", "Constraint", "ConstraintType", "Ellipse", "Entity",
    "EntityType", "Layer", "Line", "LineStyle", "Parameter", "Point",
    "Polygon", "Polyline", "Rectangle", "Sketch", "Spline",
    # Solver
    "SolveResult", "compute_dof", "evaluate_parameters", "solve",
    # Geometry
    "geometry",
]
