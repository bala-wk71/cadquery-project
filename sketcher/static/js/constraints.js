/**
 * ConstraintManager — Constraint UI manager for the parametric 2D sketcher.
 * Manages geometric and dimensional constraints, communicates with the
 * backend solver, and renders the constraint list in the right panel.
 */
(function () {
  "use strict";

  // ───────────────────────── constants ─────────────────────────

  var VALID_TYPES = [
    "coincident",
    "horizontal",
    "vertical",
    "parallel",
    "perpendicular",
    "tangent",
    "concentric",
    "equal",
    "symmetric",
    "fixed",
    "midpoint",
    "collinear",
    "distance",
    "angle",
    "radius",
  ];

  var CONSTRAINT_ICONS = {
    coincident:    "\u00B7",
    horizontal:    "H",
    vertical:      "V",
    parallel:      "\u2225",
    perpendicular: "\u22A5",
    tangent:       "T",
    concentric:    "\u25CE",
    equal:         "=",
    symmetric:     "S",
    fixed:         "\u2302",
    midpoint:      "M",
    collinear:     "\u2261",
    distance:      "D",
    angle:         "\u2220",
    radius:        "R",
  };

  // ───────────────────────── ConstraintManager ─────────────────────────

  var _idCounter = 0;

  function generateId() {
    return "cst_" + (++_idCounter);
  }

  class ConstraintManager {
    constructor() {
      /** @type {Map<string, Object>} */
      this._constraints = new Map();

      /** Last solve result from the backend */
      this._lastSolveResult = null;

      /** Callback for UI events */
      this.onConstraintAdded = null;
      this.onConstraintRemoved = null;
    }

    // ───────────── core API ─────────────

    /**
     * Create and add a constraint.
     * @param {string} type       One of VALID_TYPES
     * @param {string[]} entityIds  IDs of the involved entities
     * @param {number|null} [value] Numeric value (for distance, angle, radius)
     * @returns {Object} The created constraint
     */
    applyConstraint(type, entityIds, value) {
      if (VALID_TYPES.indexOf(type) === -1) {
        throw new Error("Unknown constraint type: " + type);
      }

      var constraint = {
        id: generateId(),
        type: type,
        entityIds: Array.isArray(entityIds) ? entityIds.slice() : [entityIds],
        value: value !== undefined ? value : null,
      };

      this._constraints.set(constraint.id, constraint);

      if (typeof this.onConstraintAdded === "function") {
        this.onConstraintAdded(constraint);
      }

      return constraint;
    }

    /**
     * Remove a constraint by ID.
     * @param {string} constraintId
     * @returns {boolean}
     */
    removeConstraint(constraintId) {
      var existed = this._constraints.delete(constraintId);
      if (existed && typeof this.onConstraintRemoved === "function") {
        this.onConstraintRemoved(constraintId);
      }
      return existed;
    }

    /**
     * Return all constraints as an array.
     * @returns {Object[]}
     */
    getConstraints() {
      return Array.from(this._constraints.values());
    }

    /**
     * Return constraints that reference a specific entity.
     * @param {string} entityId
     * @returns {Object[]}
     */
    getConstraintsForEntity(entityId) {
      var result = [];
      this._constraints.forEach(function (c) {
        if (c.entityIds.indexOf(entityId) !== -1) {
          result.push(c);
        }
      });
      return result;
    }

    /**
     * Remove all constraints.
     */
    clear() {
      this._constraints.clear();
      this._lastSolveResult = null;
    }

    // ───────────── highlighting ─────────────

    /**
     * Highlight entities involved in a constraint.
     * This adds a temporary CSS class / flag that the canvas renderer can pick up.
     * @param {string} constraintId
     * @returns {string[]|null} The entity IDs that should be highlighted, or null
     */
    highlightConstraint(constraintId) {
      var c = this._constraints.get(constraintId);
      return c ? c.entityIds.slice() : null;
    }

    // ───────────── constraint colour based on DOF ─────────────

    /**
     * Return a colour for an entity based on the last solve result.
     *   - green  (#3ec43e) : fully constrained (DOF = 0)
     *   - blue   (#4db8ff) : under-constrained (DOF > 0)
     *   - red    (#f44747) : over-constrained (DOF < 0 / conflicting)
     * @param {string} entityId
     * @returns {string} CSS colour
     */
    getConstraintColor(entityId) {
      if (!this._lastSolveResult) {
        return "#4db8ff"; // default: under-constrained
      }

      var status = this._lastSolveResult.status;
      var dof = this._lastSolveResult.dof;

      // Per-entity DOF if provided by solver
      if (this._lastSolveResult.entityDof && this._lastSolveResult.entityDof[entityId] !== undefined) {
        dof = this._lastSolveResult.entityDof[entityId];
      }

      if (dof === 0 || status === "fully_constrained") {
        return "#3ec43e";
      } else if (dof < 0 || status === "over_constrained") {
        return "#f44747";
      }
      return "#4db8ff";
    }

    // ───────────── solver communication ─────────────

    /**
     * Send the sketch to the backend solver and get updated positions.
     * @param {Object} sketch  Sketch data (entities, constraints)
     * @returns {Promise<Object>} Resolved with { entities, dof, status }
     */
    solveConstraints(sketch) {
      var self = this;

      var payload = {
        entities: sketch.entities || [],
        constraints: this.getConstraints(),
      };

      return fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Solver responded with status " + response.status);
          }
          return response.json();
        })
        .then(function (result) {
          self._lastSolveResult = {
            dof: result.dof !== undefined ? result.dof : null,
            status: result.status || "unknown",
            entityDof: result.entityDof || null,
          };
          return result;
        });
    }

    // ───────────── UI rendering ─────────────

    /**
     * Render the constraint list into a container element.
     * @param {string} containerId  The id of the container element (e.g. "tab-constraints")
     */
    updateConstraintList(containerId) {
      // Use the dedicated list sub-container if it exists,
      // so that the constraint-buttons toolbar is preserved.
      var container = document.getElementById("constraint-list")
        || document.getElementById(containerId);
      if (!container) return;

      // Clear existing children
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }

      var constraints = this.getConstraints();

      if (constraints.length === 0) {
        var empty = document.createElement("p");
        empty.className = "empty-list";
        empty.textContent = "No constraints applied";
        container.appendChild(empty);
        return;
      }

      var self = this;

      constraints.forEach(function (c) {
        var item = document.createElement("div");
        item.className = "constraint-item";
        item.setAttribute("data-constraint-id", c.id);

        // Icon
        var icon = document.createElement("span");
        icon.className = "c-icon";
        icon.textContent = CONSTRAINT_ICONS[c.type] || "?";
        icon.style.textAlign = "center";
        icon.style.fontWeight = "bold";
        item.appendChild(icon);

        // Label — type + entity IDs
        var label = document.createElement("span");
        label.className = "c-label";
        label.textContent = c.type + " (" + c.entityIds.join(", ") + ")";
        item.appendChild(label);

        // Value (if applicable)
        if (c.value !== null && c.value !== undefined) {
          var val = document.createElement("span");
          val.className = "c-value";
          val.textContent = String(c.value);
          item.appendChild(val);
        }

        // Delete button
        var remove = document.createElement("span");
        remove.className = "c-remove";
        remove.textContent = "\u00D7";
        remove.addEventListener("click", function (e) {
          e.stopPropagation();
          self.removeConstraint(c.id);
          self.updateConstraintList(containerId);
        });
        item.appendChild(remove);

        // Hover to highlight
        item.addEventListener("mouseenter", function () {
          self.highlightConstraint(c.id);
        });

        container.appendChild(item);
      });
    }
  }

  // ───────────── attach to window ─────────────
  window.ConstraintManager = ConstraintManager;
})();
