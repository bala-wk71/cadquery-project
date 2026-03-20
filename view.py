import cadquery as cq
from ocp_vscode import show
result = cq.importers.importStep("output/box_with_hole.step")
show(result)