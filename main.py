"""
Simple CadQuery Project
========================
Generates a few parametric 3D parts and exports them as STEP files.
"""

import cadquery as cq
from pathlib import Path

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)


def make_box_with_hole(length=50, width=30, height=20, hole_diameter=10):
    """A rectangular block with a centered through-hole."""
    result = (
        cq.Workplane("XY")
        .box(length, width, height)
        .faces(">Z")
        .workplane()
        .hole(hole_diameter)
    )
    return result


def make_flanged_cylinder(base_diameter=40, height=30, flange_diameter=60, flange_thickness=5):
    """A cylinder with a flange at the bottom."""
    result = (
        cq.Workplane("XY")
        .circle(flange_diameter / 2)
        .extrude(flange_thickness)
        .faces(">Z")
        .workplane()
        .circle(base_diameter / 2)
        .extrude(height)
    )
    return result


def make_mounting_plate(width=80, height=60, thickness=5, hole_spacing=30, hole_diameter=6):
    """A flat plate with four mounting holes in a rectangular pattern."""
    result = (
        cq.Workplane("XY")
        .box(width, height, thickness)
        .faces(">Z")
        .workplane()
        .rect(hole_spacing, hole_spacing, forConstruction=True)
        .vertices()
        .hole(hole_diameter)
    )
    return result


def main():
    parts = {
        "box_with_hole": make_box_with_hole(),
        "flanged_cylinder": make_flanged_cylinder(),
        "mounting_plate": make_mounting_plate(),
    }

    for name, part in parts.items():
        path = OUTPUT_DIR / f"{name}.step"
        cq.exporters.export(part, str(path))
        print(f"Exported: {path}")

    print(f"\nDone! {len(parts)} parts exported to '{OUTPUT_DIR}/'")


if __name__ == "__main__":
    main()
