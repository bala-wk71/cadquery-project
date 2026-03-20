/**
 * app.js — Main application controller for the parametric 2D sketcher.
 * Wires together all modules (CanvasEngine, SnapSystem, ToolManager,
 * ConstraintManager, HistoryManager, ExportManager), sets up the
 * render loop, event handlers, menus, and keyboard shortcuts.
 *
 * Exports: SketchApp (attached to window)
 * Auto-initialises on DOMContentLoaded.
 */
(function () {
  "use strict";

  // ───────────────────────── SketchApp ─────────────────────────

  class SketchApp {
    constructor() {
      // ── sketch data ──
      this.sketch = {
        entities: [],
        constraints: [],
        parameters: [],
        layers: [],
      };

      // ── selection state ──
      this.selectedIds = new Set();
      this.hoveredId = null;

      // ── UI flags ──
      this.gridVisible = true;
      this.snapEnabled = true;
      this._spaceHeld = false;

      // ── constraint mode state ──
      this.constraintMode = null; // { type, requiredCount, selectedIds: [] }

      // ── modules (initialised in init()) ──
      this.canvas = null;
      this.snap = null;
      this.tools = null;
      this.constraints = null;
      this.history = null;
      this.layers = null;
      this.exportMgr = null;
      this.properties = null;
      this.autoConstraints = null;
      this._autoConstraintSuggestions = [];

      // ── DOM refs ──
      this._canvasEl = null;
      this._statusCoordX = null;
      this._statusCoordY = null;
      this._statusTool = null;
      this._statusSnap = null;
      this._statusDof = null;
    }

    // ================================================================
    //  Initialisation
    // ================================================================

    init() {
      var self = this;

      // ── grab DOM elements ──
      this._canvasEl = document.getElementById("sketch-canvas");
      this._statusCoordX = document.getElementById("coord-x");
      this._statusCoordY = document.getElementById("coord-y");
      this._statusTool = document.getElementById("active-tool-name");
      this._statusSnap = document.getElementById("snap-indicator");
      this._statusGrid = document.getElementById("grid-indicator");
      this._statusDof = document.getElementById("dof-count");
      this._statusConstraintMode = document.getElementById("status-constraint-mode");
      this._constraintModeText = document.getElementById("constraint-mode-text");

      // ── initialise modules ──
      this.canvas = new window.CanvasEngine(this._canvasEl);

      this.snap = new window.SnapSystem({ gridSpacing: 1, gridEnabled: true });

      this.tools = new window.ToolManager();
      this.tools.entities = this.sketch.entities;
      this.tools.selection = [];
      this.tools.onEntityCreated = function (entity) {
        self._onEntityCreated(entity);
      };
      this.tools.onEntitiesModified = function (entities) {
        self._onEntitiesModified(entities);
      };
      this.tools.promptValue = function (message, defaultValue) {
        return prompt(message, defaultValue);
      };

      this.constraints = new window.ConstraintManager();
      this.constraints.onConstraintAdded = function () {
        self._onConstraintChange();
      };
      this.constraints.onConstraintRemoved = function () {
        self._onConstraintChange();
      };

      this.history = new window.HistoryManager();

      // Optional modules — they may not exist yet
      if (window.LayerManager) {
        this.layers = new window.LayerManager();
      }
      if (window.PropertiesPanel) {
        this.properties = new window.PropertiesPanel();
      }

      this.exportMgr = new window.ExportManager();

      // Auto-constraint engine (SolidWorks-style suggestions)
      if (window.AutoConstraintEngine) {
        this.autoConstraints = new window.AutoConstraintEngine();
      }

      // ── default tool ──
      this.tools.setTool("select");
      this._updateToolButton("select");
      this._updateCursor("select");

      // ── snap/grid indicator click handlers ──
      if (this._statusSnap) {
        this._statusSnap.addEventListener("click", function () {
          self._toggleSnap();
        });
      }
      if (this._statusGrid) {
        this._statusGrid.addEventListener("click", function () {
          self._toggleGrid();
        });
      }

      // ── bind events ──
      this._bindCanvasEvents();
      this._bindToolbarEvents();
      this._bindMenuEvents();
      this._bindKeyboardEvents();
      this._bindPanelTabs();
      this._bindConstraintButtons();
      this._bindWindowResize();

      // ── start render loop ──
      this._renderLoop();
    }

    // ================================================================
    //  Canvas events
    // ================================================================

    _bindCanvasEvents() {
      var self = this;
      var c = this._canvasEl;

      c.addEventListener("mousedown", function (e) {
        if (self._spaceHeld) {
          self._canvasEl.className = self._canvasEl.className.replace(/cursor-\S+/g, "").trim() + " cursor-grabbing";
        }
        if (self.canvas._panning) return;
        if (e.button !== 0) return;

        // ── constraint mode: intercept clicks to select entities ──
        if (self.constraintMode) {
          self._constraintModeClick(e);
          return;
        }

        var world = self._getWorldCoords(e);
        self.tools.onMouseDown(world.x, world.y, e);
      });

      c.addEventListener("mousemove", function (e) {
        var world = self._getWorldCoords(e);

        // ── update status bar coordinates ──
        if (self._statusCoordX) {
          self._statusCoordX.textContent = world.x.toFixed(2);
        }
        if (self._statusCoordY) {
          self._statusCoordY.textContent = world.y.toFixed(2);
        }

        // ── snap ──
        if (self.snapEnabled) {
          var snapRadius = 10 / self.canvas.scale; // 10 screen pixels
          var snapResult = self.snap.findSnap(
            world.x,
            world.y,
            self.sketch.entities,
            snapRadius
          );
          if (snapResult) {
            world.x = snapResult.x;
            world.y = snapResult.y;
          }
        }

        // ── hit test for hover ──
        self.hoveredId = self.canvas.hitTest(
          e.offsetX,
          e.offsetY,
          self.sketch.entities,
          6
        );

        // ── auto-constraint detection while drawing ──
        if (self.autoConstraints && self.autoConstraints.enabled) {
          var preview = self.tools.getPreview();
          var activeTool = self.tools.getActiveTool();
          var drawingTools = ['line','polyline','rectangle','circle','arc','ellipse','polygon','spline','point'];
          if (preview && preview.length > 0 && drawingTools.indexOf(activeTool) !== -1) {
            var currentEntity = preview[preview.length - 1];
            var tolerance = 10 / self.canvas.scale;
            self._autoConstraintSuggestions = self.autoConstraints.detect(
              currentEntity, self.sketch.entities, world, tolerance
            );
            // Apply snap adjustments from suggestions (e.g., snap to horizontal/vertical)
            if (self._autoConstraintSuggestions.length > 0) {
              var topSuggestion = self._autoConstraintSuggestions[0];
              if (topSuggestion.snapPoint) {
                world.x = topSuggestion.snapPoint.x;
                world.y = topSuggestion.snapPoint.y;
              }
            }
          } else {
            self._autoConstraintSuggestions = [];
          }
        }

        // ── pass to active tool ──
        if (!self.canvas._panning) {
          self.tools.onMouseMove(world.x, world.y, e);
        }
      });

      c.addEventListener("mouseup", function (e) {
        if (self._spaceHeld) {
          self._canvasEl.className = self._canvasEl.className.replace(/cursor-\S+/g, "").trim() + " cursor-grab";
        }
        if (self.canvas._panning) return;
        if (e.button !== 0) return;
        var world = self._getWorldCoords(e);
        self.tools.onMouseUp(world.x, world.y, e);
      });

      // ── mouse wheel zoom ──
      // CanvasEngine already handles wheel zoom internally.
    }

    /**
     * Convert a mouse event to snapped world coordinates.
     */
    _getWorldCoords(e) {
      var world = this.canvas.screenToWorld(e.offsetX, e.offsetY);

      if (this.snapEnabled) {
        var snapRadius = 10 / this.canvas.scale;
        var snapResult = this.snap.findSnap(
          world.x,
          world.y,
          this.sketch.entities,
          snapRadius
        );
        if (snapResult) {
          return { x: snapResult.x, y: snapResult.y };
        }
      }

      return world;
    }

    // ================================================================
    //  Toolbar events
    // ================================================================

    _bindToolbarEvents() {
      var self = this;
      var buttons = document.querySelectorAll("#toolbar .tool-btn");

      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var toolName = btn.getAttribute("data-tool");
          if (toolName) {
            self.tools.setTool(toolName);
            self._updateToolButton(toolName);
            self._updateStatusTool(toolName);
            self._updateCursor(toolName);
          }
        });
      });
    }

    _updateToolButton(activeToolName) {
      var buttons = document.querySelectorAll("#toolbar .tool-btn");
      buttons.forEach(function (btn) {
        if (btn.getAttribute("data-tool") === activeToolName) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    _updateStatusTool(toolName) {
      if (this._statusTool) {
        // Capitalise first letter
        this._statusTool.textContent =
          toolName.charAt(0).toUpperCase() + toolName.slice(1);
      }
    }

    // ================================================================
    //  Menu bar events
    // ================================================================

    _bindMenuEvents() {
      var self = this;

      // ── dropdown toggle ──
      var menuItems = document.querySelectorAll("#menu-bar .menu-item");
      menuItems.forEach(function (item) {
        item.addEventListener("click", function (e) {
          // If clicking an action inside the dropdown, don't toggle
          if (e.target.classList.contains("menu-action")) return;

          var wasOpen = item.classList.contains("open");

          // Close all
          menuItems.forEach(function (m) {
            m.classList.remove("open");
          });

          if (!wasOpen) {
            item.classList.add("open");
          }
        });
      });

      // ── close menus on outside click ──
      document.addEventListener("click", function (e) {
        if (!e.target.closest("#menu-bar")) {
          menuItems.forEach(function (m) {
            m.classList.remove("open");
          });
        }
      });

      // ── menu actions ──
      var actions = document.querySelectorAll("#menu-bar .menu-action");
      actions.forEach(function (action) {
        action.addEventListener("click", function () {
          var act = action.getAttribute("data-action");
          self._handleMenuAction(act);
          // Close dropdowns
          menuItems.forEach(function (m) {
            m.classList.remove("open");
          });
        });
      });
    }

    _handleMenuAction(action) {
      var self = this;

      switch (action) {
        // ── File ──
        case "file-new":
          this._newSketch();
          break;
        case "file-save":
          this._saveSketch();
          break;
        case "file-open":
          this._openSketch();
          break;
        case "export-svg":
          this.exportMgr.exportSVG(this.sketch);
          break;
        case "export-dxf":
          this.exportMgr.exportDXF(this.sketch);
          break;
        case "export-png":
          this.exportMgr.exportPNG(this._canvasEl);
          break;

        // ── Edit ──
        case "undo":
          this.history.undo();
          this._afterSketchChange();
          break;
        case "redo":
          this.history.redo();
          this._afterSketchChange();
          break;
        case "select-all":
          this._selectAll();
          break;
        case "delete":
          this._deleteSelection();
          break;

        // ── View ──
        case "zoom-in":
          this._zoomBy(1.25);
          break;
        case "zoom-out":
          this._zoomBy(1 / 1.25);
          break;
        case "fit-all":
          this.canvas.fitAll(this.sketch);
          break;
        case "toggle-grid":
          this._toggleGrid();
          break;
        case "toggle-snap":
          this._toggleSnap();
          break;

        // ── Tools ──
        default:
          // Tool selection from Tools menu
          if (action && action.startsWith("tool-")) {
            var toolName = action.substring(5); // strip "tool-"
            this.tools.setTool(toolName);
            this._updateToolButton(toolName);
            this._updateStatusTool(toolName);
            this._updateCursor(toolName);
          }
          // Constraint application from Constraints menu
          else if (action && action.startsWith("cst-")) {
            var cstType = action.substring(4); // strip "cst-"
            this._applyConstraint(cstType);
          }
          break;
      }
    }

    // ================================================================
    //  Keyboard shortcuts
    // ================================================================

    _bindKeyboardEvents() {
      var self = this;

      window.addEventListener("keydown", function (e) {
        // Don't intercept when typing in an input
        if (
          e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable
        ) {
          return;
        }

        var ctrl = e.ctrlKey || e.metaKey;

        // ── Ctrl combos ──
        if (ctrl) {
          switch (e.key.toLowerCase()) {
            case "z":
              e.preventDefault();
              self.history.undo();
              self._afterSketchChange();
              return;
            case "y":
              e.preventDefault();
              self.history.redo();
              self._afterSketchChange();
              return;
            case "a":
              e.preventDefault();
              self._selectAll();
              return;
          }
        }

        // ── Single key shortcuts ──
        switch (e.key) {
          case "Delete":
          case "Backspace":
            e.preventDefault();
            self._deleteSelection();
            return;
          case "Escape":
            e.preventDefault();
            if (self.constraintMode) {
              self._exitConstraintMode();
            } else {
              self._cancelAndDeselect();
            }
            return;
        }

        // ── Letter shortcuts (no ctrl) ──
        if (!ctrl) {
          switch (e.key.toLowerCase()) {
            case "g":
              self._toggleGrid();
              return;
            case "s":
              self._toggleSnap();
              return;
            case "l":
              self._switchTool("line");
              return;
            case "c":
              self._switchTool("circle");
              return;
            case "r":
              self._switchTool("rectangle");
              return;
            case "a":
              self._switchTool("arc");
              return;
            case "e":
              self._switchTool("ellipse");
              return;
            case "p":
              self._switchTool("point");
              return;
            case " ":
              // Space held for pan — handled by CanvasEngine
              self._spaceHeld = true;
              self._canvasEl.className = self._canvasEl.className.replace(/cursor-\S+/g, "").trim() + " cursor-grab";
              return;
          }
        }

        // ── Pass to active tool for tool-specific keys ──
        self.tools.onKeyDown(e);
      });

      window.addEventListener("keyup", function (e) {
        if (e.key === " ") {
          self._spaceHeld = false;
          // Restore tool cursor
          var currentTool = self.tools.getActiveTool();
          var toolName = currentTool && currentTool.name ? currentTool.name : "select";
          self._updateCursor(toolName);
        }
      });
    }

    _switchTool(name) {
      this.tools.setTool(name);
      this._updateToolButton(name);
      this._updateStatusTool(name);
      this._updateCursor(name);
    }

    _updateCursor(toolName) {
      var c = this._canvasEl;
      // Remove all cursor-* classes
      var classes = c.className.split(/\s+/).filter(function (cls) {
        return cls.indexOf("cursor-") !== 0;
      });

      var cursorClass;
      switch (toolName) {
        case "point":
        case "line":
        case "polyline":
        case "rectangle":
        case "circle":
        case "arc":
        case "ellipse":
        case "polygon":
        case "spline":
        case "trim":
        case "extend":
        case "fillet":
        case "chamfer":
        case "rotate":
        case "scale":
          cursorClass = "cursor-crosshair";
          break;
        case "select":
          cursorClass = "cursor-pointer";
          break;
        case "move":
          cursorClass = "cursor-move";
          break;
        case "copy":
          cursorClass = "cursor-copy";
          break;
        case "delete":
          cursorClass = "cursor-not-allowed";
          break;
        case "offset":
        case "mirror":
        case "constraint-mode":
          cursorClass = "cursor-cell";
          break;
        default:
          cursorClass = "cursor-crosshair";
          break;
      }

      classes.push(cursorClass);
      c.className = classes.join(" ");
    }

    // ================================================================
    //  Panel tabs (Constraints / Parameters)
    // ================================================================

    _bindPanelTabs() {
      var tabs = document.querySelectorAll("#constraints-panel .panel-tab");
      tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
          var target = tab.getAttribute("data-tab");

          // Activate tab
          tabs.forEach(function (t) {
            t.classList.remove("active");
          });
          tab.classList.add("active");

          // Show pane
          var panes = document.querySelectorAll(
            "#constraints-panel .tab-pane"
          );
          panes.forEach(function (pane) {
            pane.classList.remove("active");
          });
          var activePane = document.getElementById("tab-" + target);
          if (activePane) {
            activePane.classList.add("active");
          }
        });
      });
    }

    // ================================================================
    //  Window resize
    // ================================================================

    _bindWindowResize() {
      var self = this;
      window.addEventListener("resize", function () {
        if (self._canvasEl) {
          self._canvasEl.width = self._canvasEl.clientWidth;
          self._canvasEl.height = self._canvasEl.clientHeight;
        }
      });
    }

    // ================================================================
    //  Render loop
    // ================================================================

    _renderLoop() {
      var self = this;

      function frame() {
        self._render();
        requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    }

    _render() {
      // ── main scene ──
      this.canvas.render(
        this.sketch,
        this.selectedIds,
        this.hoveredId,
        this.tools.getActiveTool()
      );

      // ── tool preview geometry ──
      var previews = this.tools.getPreview();
      if (previews && previews.length > 0) {
        var ctx = this.canvas.ctx;
        for (var i = 0; i < previews.length; i++) {
          var p = previews[i];
          // Draw preview entities with a dashed orange style
          ctx.save();
          ctx.strokeStyle = "#e08030";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          this.canvas._drawEntity(ctx, p, "construction");
          ctx.restore();
        }
      }

      // ── auto-constraint suggestions ──
      if (this.autoConstraints && this._autoConstraintSuggestions.length > 0) {
        this.autoConstraints.renderSuggestions(
          this.canvas.ctx,
          this._autoConstraintSuggestions,
          this.canvas
        );
      }

      // ── snap indicator ──
      this._drawSnapIndicator();
    }

    _drawSnapIndicator() {
      if (!this.snapEnabled) return;

      var snapRadius = 10 / this.canvas.scale;
      var world = this.canvas.screenToWorld(
        this.canvas.mouseScreenX,
        this.canvas.mouseScreenY
      );
      var snapResult = this.snap.findSnap(
        world.x,
        world.y,
        this.sketch.entities,
        snapRadius
      );
      if (!snapResult) return;

      var screen = this.canvas.worldToScreen(snapResult.x, snapResult.y);
      var ctx = this.canvas.ctx;

      ctx.save();
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);

      var size = 6;

      switch (snapResult.type) {
        case "endpoint":
          // Square
          ctx.strokeRect(
            screen.x - size,
            screen.y - size,
            size * 2,
            size * 2
          );
          break;
        case "midpoint":
          // Triangle
          ctx.beginPath();
          ctx.moveTo(screen.x, screen.y - size);
          ctx.lineTo(screen.x - size, screen.y + size);
          ctx.lineTo(screen.x + size, screen.y + size);
          ctx.closePath();
          ctx.stroke();
          break;
        case "center":
          // Circle
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case "intersection":
          // X cross
          ctx.beginPath();
          ctx.moveTo(screen.x - size, screen.y - size);
          ctx.lineTo(screen.x + size, screen.y + size);
          ctx.moveTo(screen.x + size, screen.y - size);
          ctx.lineTo(screen.x - size, screen.y + size);
          ctx.stroke();
          break;
        default:
          // Diamond
          ctx.beginPath();
          ctx.moveTo(screen.x, screen.y - size);
          ctx.lineTo(screen.x + size, screen.y);
          ctx.lineTo(screen.x, screen.y + size);
          ctx.lineTo(screen.x - size, screen.y);
          ctx.closePath();
          ctx.stroke();
          break;
      }

      ctx.restore();
    }

    // ================================================================
    //  Entity management callbacks
    // ================================================================

    _onEntityCreated(entity) {
      var self = this;

      // Assign to active layer
      if (this.layers && typeof this.layers.getActiveLayer === "function") {
        entity.layerId = this.layers.getActiveLayer();
      }

      // Create and execute history command
      var cmd = window.AddEntityCommand(this.sketch, entity);
      this.history.execute(cmd);

      // Sync the tools reference
      this.tools.entities = this.sketch.entities;

      // ── Auto-apply suggested constraints ──
      if (this.autoConstraints && this._autoConstraintSuggestions.length > 0) {
        var accepted = this.autoConstraints.acceptSuggestions(this._autoConstraintSuggestions);
        for (var i = 0; i < accepted.length; i++) {
          var ac = accepted[i];
          // Replace placeholder entity IDs — the first entityId in the suggestion
          // that doesn't exist yet should be the just-created entity
          var ids = [];
          for (var j = 0; j < ac.entityIds.length; j++) {
            ids.push(ac.entityIds[j]);
          }
          // If the suggestion references the preview entity, replace with the real ID
          for (var k = 0; k < ids.length; k++) {
            if (ids[k] === '__current__' || ids[k] === 'current') {
              ids[k] = entity.id;
            }
          }
          // Ensure the new entity is referenced
          if (ids.indexOf(entity.id) === -1) {
            ids.push(entity.id);
          }
          this.constraints.applyConstraint(ac.type, ids, ac.value || null);
        }
        this._autoConstraintSuggestions = [];
      }

      this._afterSketchChange();
    }

    _onEntitiesModified(entities) {
      // Build a composite command for all modifications
      var commands = [];

      for (var i = 0; i < entities.length; i++) {
        var ent = entities[i];
        var original = this.sketch.entities.find(function (e) {
          return e.id === ent.id;
        });
        if (original) {
          var oldProps = JSON.parse(JSON.stringify(original));
          var newProps = JSON.parse(JSON.stringify(ent));
          // Remove id from props — it doesn't change
          delete oldProps.id;
          delete newProps.id;
          commands.push(
            window.ModifyEntityCommand(this.sketch, ent.id, oldProps, newProps)
          );
        }
      }

      if (commands.length > 0) {
        var composite = window.CompositeCommand(commands, "Modify entities");
        this.history.execute(composite);
      }

      this._afterSketchChange();
    }

    // ================================================================
    //  Constraint management
    // ================================================================

    _applyConstraint(type) {
      var entityIds = Array.from(this.selectedIds);
      if (entityIds.length === 0) {
        // No selection — enter constraint mode so user can pick entities
        this._enterConstraintMode(type);
        return;
      }

      // Dimensional constraints may need a value
      var value = null;
      if (
        type === "distance" ||
        type === "angle" ||
        type === "radius" ||
        type === "diameter"
      ) {
        var input = prompt("Enter " + type + " value:");
        if (input === null) return; // cancelled
        value = parseFloat(input);
        if (isNaN(value)) {
          this._setStatus("Invalid " + type + " value", "error");
          return;
        }
      }

      try {
        var constraint = this.constraints.applyConstraint(
          type,
          entityIds,
          value
        );

        // Add to sketch data and history
        var cmd = window.AddConstraintCommand(this.sketch, constraint);
        this.history.execute(cmd);

        this._afterSketchChange();
      } catch (err) {
        this._setStatus(err.message, "error");
      }
    }

    _onConstraintChange() {
      this.constraints.updateConstraintList("tab-constraints");
      this._solveConstraints();
    }

    // ================================================================
    //  Constraint mode — pick-then-apply workflow
    // ================================================================

    /**
     * Required entity count per constraint type.
     */
    _constraintEntityCount(type) {
      switch (type) {
        case "horizontal":
        case "vertical":
        case "fixed":
        case "radius":
        case "diameter":
          return 1;
        case "coincident":
        case "parallel":
        case "perpendicular":
        case "tangent":
        case "concentric":
        case "equal":
        case "symmetric":
        case "midpoint":
        case "collinear":
        case "distance":
        case "angle":
          return 2;
        default:
          return 1;
      }
    }

    /**
     * Enter constraint mode: user picks entities, then constraint is applied.
     */
    _enterConstraintMode(type) {
      var requiredCount = this._constraintEntityCount(type);

      this.constraintMode = {
        type: type,
        requiredCount: requiredCount,
        selectedIds: [],
      };

      // Clear normal selection
      this.selectedIds.clear();
      this.tools.selection = [];

      // Set cursor to cell
      this._updateCursor("constraint-mode");

      // Update status bar
      this._updateConstraintModeStatus();

      // Highlight active constraint button
      var btns = document.querySelectorAll("#constraint-buttons .cst-btn");
      btns.forEach(function (btn) {
        if (btn.getAttribute("data-cst") === type) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    /**
     * Exit constraint mode without applying.
     */
    _exitConstraintMode() {
      this.constraintMode = null;

      // Restore cursor
      this._updateCursor("select");

      // Hide constraint mode status
      if (this._statusConstraintMode) {
        this._statusConstraintMode.style.display = "none";
      }

      // Remove active state from constraint buttons
      var btns = document.querySelectorAll("#constraint-buttons .cst-btn");
      btns.forEach(function (btn) {
        btn.classList.remove("active");
      });

      // Clear any constraint-mode selection highlights
      this.selectedIds.clear();
      this.tools.selection = [];
      this._onSelectionChange();
    }

    /**
     * Update the constraint mode status bar text.
     */
    _updateConstraintModeStatus() {
      if (!this._statusConstraintMode || !this._constraintModeText) return;
      if (!this.constraintMode) {
        this._statusConstraintMode.style.display = "none";
        return;
      }

      var cm = this.constraintMode;
      var label = cm.type.charAt(0).toUpperCase() + cm.type.slice(1);
      this._constraintModeText.textContent =
        "Select entities for " + label + " (" + cm.selectedIds.length + "/" + cm.requiredCount + ")";
      this._statusConstraintMode.style.display = "";
    }

    /**
     * Handle a canvas click while in constraint mode.
     */
    _constraintModeClick(e) {
      if (!this.constraintMode) return;

      // Hit test to find clicked entity
      var entityId = this.canvas.hitTest(
        e.offsetX,
        e.offsetY,
        this.sketch.entities,
        6
      );

      if (!entityId) return; // clicked empty space, ignore

      var cm = this.constraintMode;

      // Don't add the same entity twice
      if (cm.selectedIds.indexOf(entityId) !== -1) return;

      cm.selectedIds.push(entityId);

      // Highlight selected entities with orange via the normal selection set
      this.selectedIds.add(entityId);

      // Update status
      this._updateConstraintModeStatus();

      // Check if we have enough entities
      if (cm.selectedIds.length >= cm.requiredCount) {
        this._finishConstraintMode();
      }
    }

    /**
     * Finish constraint mode: apply the constraint and exit.
     */
    _finishConstraintMode() {
      if (!this.constraintMode) return;

      var cm = this.constraintMode;
      var type = cm.type;
      var entityIds = cm.selectedIds.slice();

      // Exit constraint mode first (clears state)
      this._exitConstraintMode();

      // Dimensional constraints need a value prompt
      var value = null;
      if (
        type === "distance" ||
        type === "angle" ||
        type === "radius" ||
        type === "diameter"
      ) {
        var input = prompt("Enter " + type + " value:");
        if (input === null) return; // cancelled
        value = parseFloat(input);
        if (isNaN(value)) {
          this._setStatus("Invalid " + type + " value", "error");
          return;
        }
      }

      try {
        var constraint = this.constraints.applyConstraint(
          type,
          entityIds,
          value
        );

        var cmd = window.AddConstraintCommand(this.sketch, constraint);
        this.history.execute(cmd);

        this._afterSketchChange();
        this._setStatus(
          type.charAt(0).toUpperCase() + type.slice(1) + " constraint applied",
          "success"
        );
      } catch (err) {
        this._setStatus(err.message, "error");
      }
    }

    /**
     * Bind click handlers on the constraint quick-apply buttons.
     */
    _bindConstraintButtons() {
      var self = this;
      var btns = document.querySelectorAll("#constraint-buttons .cst-btn");
      btns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var cstType = btn.getAttribute("data-cst");
          if (!cstType) return;

          // If already in constraint mode for this type, cancel it
          if (self.constraintMode && self.constraintMode.type === cstType) {
            self._exitConstraintMode();
            return;
          }

          // If entities are already selected, apply immediately
          if (self.selectedIds.size > 0) {
            self._applyConstraint(cstType);
          } else {
            // Enter constraint mode
            self._enterConstraintMode(cstType);
          }
        });
      });
    }

    _solveConstraints() {
      var self = this;

      this.constraints
        .solveConstraints(this.sketch)
        .then(function (result) {
          if (result && result.entities) {
            // Update entity positions from solver
            for (var i = 0; i < result.entities.length; i++) {
              var solved = result.entities[i];
              var original = self.sketch.entities.find(function (e) {
                return e.id === solved.id;
              });
              if (original) {
                Object.assign(original, solved);
              }
            }
          }
          // Update DOF display
          if (self._statusDof && result) {
            self._statusDof.textContent =
              result.dof !== undefined ? String(result.dof) : "?";
          }
        })
        .catch(function (err) {
          console.warn("Constraint solve failed:", err);
        });
    }

    // ================================================================
    //  Sketch operations
    // ================================================================

    _newSketch() {
      if (
        this.sketch.entities.length > 0 &&
        !confirm("Discard current sketch?")
      ) {
        return;
      }

      this.sketch.entities.length = 0;
      this.sketch.constraints.length = 0;
      this.sketch.parameters.length = 0;
      this.sketch.layers.length = 0;
      this.selectedIds.clear();
      this.hoveredId = null;
      this.history.clear();
      this.constraints.clear();
      this.tools.entities = this.sketch.entities;
      this.tools.selection = [];

      this.canvas.fitAll(null);
      this._afterSketchChange();
      this._setStatus("New sketch", "success");
    }

    _saveSketch() {
      var name = prompt("Sketch name:", "untitled");
      if (!name) return;
      this.exportMgr.saveSketch(this.sketch, name);
    }

    _openSketch() {
      var self = this;
      var name = prompt("Sketch name to load:");
      if (!name) return;

      this.exportMgr.loadSketch(name).then(function (data) {
        if (data) {
          self.sketch.entities = data.entities || [];
          self.sketch.constraints = data.constraints || [];
          self.sketch.parameters = data.parameters || [];
          self.sketch.layers = data.layers || [];
          self.selectedIds.clear();
          self.hoveredId = null;
          self.history.clear();
          self.tools.entities = self.sketch.entities;
          self.tools.selection = [];
          self.canvas.fitAll(self.sketch);
          self._afterSketchChange();
        }
      });
    }

    _selectAll() {
      this.selectedIds.clear();
      for (var i = 0; i < this.sketch.entities.length; i++) {
        this.selectedIds.add(this.sketch.entities[i].id);
      }
      this.tools.selection = Array.from(this.selectedIds);
      this._onSelectionChange();
    }

    _deleteSelection() {
      if (this.selectedIds.size === 0) return;

      var commands = [];
      var self = this;

      this.selectedIds.forEach(function (id) {
        commands.push(window.DeleteEntityCommand(self.sketch, id));

        // Also remove constraints referencing this entity
        var relatedConstraints =
          self.constraints.getConstraintsForEntity(id);
        for (var i = 0; i < relatedConstraints.length; i++) {
          self.constraints.removeConstraint(relatedConstraints[i].id);
          commands.push(
            window.DeleteConstraintCommand(
              self.sketch,
              relatedConstraints[i].id
            )
          );
        }
      });

      if (commands.length > 0) {
        var composite = window.CompositeCommand(commands, "Delete selection");
        this.history.execute(composite);
      }

      this.selectedIds.clear();
      this.tools.selection = [];
      this.tools.entities = this.sketch.entities;
      this._afterSketchChange();
    }

    _cancelAndDeselect() {
      // Cancel current tool — re-activate select tool
      this.tools.setTool("select");
      this._updateToolButton("select");
      this._updateStatusTool("select");
      this._updateCursor("select");

      // Deselect
      this.selectedIds.clear();
      this.tools.selection = [];
      this._onSelectionChange();
    }

    // ================================================================
    //  View operations
    // ================================================================

    _zoomBy(factor) {
      var cx = this._canvasEl.width / 2;
      var cy = this._canvasEl.height / 2;

      var wx = (cx - this.canvas.offsetX) / this.canvas.scale;
      var wy = (cy - this.canvas.offsetY) / this.canvas.scale;

      this.canvas.scale = Math.max(
        this.canvas.minScale,
        Math.min(this.canvas.maxScale, this.canvas.scale * factor)
      );

      this.canvas.offsetX = cx - wx * this.canvas.scale;
      this.canvas.offsetY = cy - wy * this.canvas.scale;
    }

    _toggleGrid() {
      this.gridVisible = !this.gridVisible;
      // Toggle grid drawing via gridMajor — 0 hides it
      if (this.gridVisible) {
        this.canvas.gridMajor = 1;
      } else {
        this.canvas.gridMajor = 0;
      }
      if (this._statusGrid) {
        this._statusGrid.textContent = this.gridVisible ? "Grid: ON" : "Grid: OFF";
        if (this.gridVisible) {
          this._statusGrid.classList.remove("off");
        } else {
          this._statusGrid.classList.add("off");
        }
      }
    }

    _toggleSnap() {
      this.snapEnabled = !this.snapEnabled;
      if (this._statusSnap) {
        this._statusSnap.textContent = this.snapEnabled ? "Snap: ON" : "Snap: OFF";
        if (this.snapEnabled) {
          this._statusSnap.classList.remove("off");
        } else {
          this._statusSnap.classList.add("off");
        }
      }
    }

    // ================================================================
    //  Selection / properties updates
    // ================================================================

    _onSelectionChange() {
      // Update properties panel
      if (this.properties && typeof this.properties.update === "function") {
        var selectedEntities = [];
        var self = this;
        this.selectedIds.forEach(function (id) {
          var ent = self.sketch.entities.find(function (e) {
            return e.id === id;
          });
          if (ent) selectedEntities.push(ent);
        });
        this.properties.update(selectedEntities, function (entityId, prop, value) {
          self._onPropertyEdit(entityId, prop, value);
        });
      } else {
        // Manual properties panel update
        this._updatePropertiesPanel();
      }

      // Update constraint list for selected entities
      this.constraints.updateConstraintList("tab-constraints");
    }

    _onPropertyEdit(entityId, prop, value) {
      var entity = this.sketch.entities.find(function (e) {
        return e.id === entityId;
      });
      if (!entity) return;

      var oldProps = {};
      var newProps = {};
      oldProps[prop] = entity[prop];
      newProps[prop] = value;

      var cmd = window.ModifyEntityCommand(
        this.sketch,
        entityId,
        oldProps,
        newProps
      );
      this.history.execute(cmd);

      this._afterSketchChange();
    }

    /**
     * Fallback properties panel rendering when PropertiesPanel module
     * is not available.
     */
    _updatePropertiesPanel() {
      var body = document.getElementById("properties-body");
      if (!body) return;

      // Clear
      body.innerHTML = "";

      if (this.selectedIds.size === 0) {
        body.innerHTML = '<p class="prop-empty">No selection</p>';
        return;
      }

      var self = this;

      this.selectedIds.forEach(function (id) {
        var entity = self.sketch.entities.find(function (e) {
          return e.id === id;
        });
        if (!entity) return;

        // Type row (read-only)
        self._addPropRow(body, "Type", entity.type, true);
        self._addPropRow(body, "ID", entity.id, true);

        // Editable properties based on type
        var editableProps = self._getEditableProps(entity);
        for (var i = 0; i < editableProps.length; i++) {
          var prop = editableProps[i];
          self._addPropRow(body, prop, entity[prop], false, entity.id, prop);
        }
      });
    }

    _getEditableProps(entity) {
      switch (entity.type) {
        case "point":
          return ["x", "y"];
        case "line":
          return ["x1", "y1", "x2", "y2"];
        case "circle":
          return ["cx", "cy", "r"];
        case "arc":
          return ["cx", "cy", "r", "startAngle", "endAngle"];
        case "ellipse":
          return ["cx", "cy", "rx", "ry", "rotation"];
        case "rectangle":
          return ["x", "y", "width", "height"];
        default:
          return [];
      }
    }

    _addPropRow(container, label, value, readOnly, entityId, propName) {
      var self = this;
      var row = document.createElement("div");
      row.className = "prop-row";

      var labelEl = document.createElement("span");
      labelEl.className = "prop-label";
      labelEl.textContent = label;
      row.appendChild(labelEl);

      var valueContainer = document.createElement("span");
      valueContainer.className = "prop-value";

      var input = document.createElement("input");
      input.type = typeof value === "number" ? "number" : "text";
      input.value = value !== undefined && value !== null ? value : "";
      input.step = "any";

      if (readOnly) {
        input.readOnly = true;
      } else {
        input.addEventListener("change", function () {
          var newValue =
            input.type === "number" ? parseFloat(input.value) : input.value;
          if (entityId && propName) {
            self._onPropertyEdit(entityId, propName, newValue);
          }
        });
      }

      valueContainer.appendChild(input);
      row.appendChild(valueContainer);
      container.appendChild(row);
    }

    // ================================================================
    //  After-change hook
    // ================================================================

    _afterSketchChange() {
      this.tools.entities = this.sketch.entities;
      this._onSelectionChange();

      // Trigger constraint solve if there are constraints
      if (this.sketch.constraints.length > 0) {
        this._solveConstraints();
      }
    }

    // ================================================================
    //  Status bar helper
    // ================================================================

    _setStatus(message, level) {
      if (!this._statusTool) return;
      this._statusTool.textContent = message;
      this._statusTool.style.color =
        level === "error"
          ? "#f44747"
          : level === "success"
          ? "#3ec43e"
          : "";
      var el = this._statusTool;
      if (level) {
        setTimeout(function () {
          el.style.color = "";
        }, 3000);
      }
    }
  }

  // ───────────────────────── expose & auto-init ─────────────────────────

  window.SketchApp = SketchApp;

  document.addEventListener("DOMContentLoaded", function () {
    var app = new SketchApp();
    app.init();
    window.app = app;
  });
})();
