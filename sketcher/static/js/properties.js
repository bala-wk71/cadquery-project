/**
 * PropertiesPanel — Properties panel manager for the parametric 2D sketcher.
 * Displays and edits entity properties, manages the parameters table,
 * and provides a layer selector.
 */
(function () {
  "use strict";

  // ───────────────────────── helpers ─────────────────────────

  /**
   * Create a labelled property row using DOM API (no innerHTML).
   * @param {string} labelText
   * @param {HTMLElement} inputEl
   * @param {boolean} [readOnly]
   * @returns {HTMLElement}
   */
  function createPropRow(labelText, inputEl, readOnly) {
    var row = document.createElement("div");
    row.className = "prop-row";

    var label = document.createElement("span");
    label.className = "prop-label";
    label.textContent = labelText;
    row.appendChild(label);

    var valueWrap = document.createElement("span");
    valueWrap.className = "prop-value";
    if (readOnly) {
      inputEl.readOnly = true;
      inputEl.style.opacity = "0.6";
    }
    valueWrap.appendChild(inputEl);
    row.appendChild(valueWrap);

    return row;
  }

  /**
   * Create a number input element.
   */
  function createNumberInput(value, step) {
    var input = document.createElement("input");
    input.type = "number";
    input.value = value !== undefined && value !== null ? value : "";
    input.step = step || "any";
    return input;
  }

  /**
   * Create a text input element.
   */
  function createTextInput(value) {
    var input = document.createElement("input");
    input.type = "text";
    input.value = value !== undefined && value !== null ? String(value) : "";
    return input;
  }

  // ───────────────────────── entity field definitions ─────────────────────────

  var ENTITY_FIELDS = {
    point: [
      { key: "x", label: "X", type: "number" },
      { key: "y", label: "Y", type: "number" },
    ],
    line: [
      { key: "x1", label: "X1", type: "number" },
      { key: "y1", label: "Y1", type: "number" },
      { key: "x2", label: "X2", type: "number" },
      { key: "y2", label: "Y2", type: "number" },
      { key: "_length", label: "Length", type: "number", readOnly: true, compute: computeLineLength },
    ],
    circle: [
      { key: "cx", label: "Center X", type: "number" },
      { key: "cy", label: "Center Y", type: "number" },
      { key: "r",  label: "Radius",   type: "number" },
    ],
    arc: [
      { key: "cx", label: "Center X",    type: "number" },
      { key: "cy", label: "Center Y",    type: "number" },
      { key: "r",  label: "Radius",      type: "number" },
      { key: "startAngle", label: "Start \u00B0", type: "number" },
      { key: "endAngle",   label: "End \u00B0",   type: "number" },
    ],
    ellipse: [
      { key: "cx", label: "Center X",  type: "number" },
      { key: "cy", label: "Center Y",  type: "number" },
      { key: "rx", label: "Radius X",  type: "number" },
      { key: "ry", label: "Radius Y",  type: "number" },
      { key: "rotation", label: "Rotation", type: "number" },
    ],
    rectangle: [
      { key: "x",      label: "X",      type: "number" },
      { key: "y",      label: "Y",      type: "number" },
      { key: "width",  label: "Width",  type: "number" },
      { key: "height", label: "Height", type: "number" },
    ],
    polygon: [
      { key: "cx",    label: "Center X", type: "number" },
      { key: "cy",    label: "Center Y", type: "number" },
      { key: "r",     label: "Radius",   type: "number" },
      { key: "sides", label: "Sides",    type: "number" },
    ],
    spline:   null, // special handling
    polyline: null, // special handling
  };

  function computeLineLength(entity) {
    var dx = (entity.x2 || 0) - (entity.x1 || 0);
    var dy = (entity.y2 || 0) - (entity.y1 || 0);
    return Math.sqrt(dx * dx + dy * dy).toFixed(4);
  }

  // ───────────────────────── PropertiesPanel ─────────────────────────

  class PropertiesPanel {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.propertiesContentId="properties-body"]
     * @param {string} [opts.parametersTabId="tab-parameters"]
     */
    constructor(opts) {
      opts = opts || {};
      this._contentId = opts.propertiesContentId || "properties-body";
      this._paramsTabId = opts.parametersTabId || "tab-parameters";

      /** Callback: (entityId, property, value) => void */
      this.onPropertyChanged = null;

      /** Callback: (params) => void */
      this.onParameterChanged = null;

      /** Currently displayed entity id */
      this._currentEntityId = null;

      /** Available layers for the layer selector */
      this._layers = [];
    }

    // ───────────── entity properties ─────────────

    /**
     * Show editable properties for a single entity.
     * @param {Object} entity  Must have at least { id, type }
     */
    showEntityProperties(entity) {
      var container = document.getElementById(this._contentId);
      if (!container) return;

      this._clear(container);
      this._currentEntityId = entity.id;

      // Type header row (read-only)
      var typeInput = createTextInput(entity.type);
      container.appendChild(createPropRow("Type", typeInput, true));

      // ID row (read-only)
      var idInput = createTextInput(entity.id);
      container.appendChild(createPropRow("ID", idInput, true));

      var entityType = (entity.type || "").toLowerCase();
      var fields = ENTITY_FIELDS[entityType];

      if (fields) {
        this._renderFields(container, entity, fields);
      } else if (entityType === "spline" || entityType === "polyline") {
        this._renderPointList(container, entity);
      }

      // Layer selector
      this._renderLayerSelector(container, entity);
    }

    /**
     * Render standard property fields.
     */
    _renderFields(container, entity, fields) {
      var self = this;

      fields.forEach(function (field) {
        var value;
        if (field.compute) {
          value = field.compute(entity);
        } else {
          value = entity[field.key];
        }

        var input = createNumberInput(value);
        var row = createPropRow(field.label, input, !!field.readOnly);
        container.appendChild(row);

        if (!field.readOnly) {
          input.addEventListener("change", function () {
            var newVal = parseFloat(input.value);
            if (!isNaN(newVal) && typeof self.onPropertyChanged === "function") {
              self.onPropertyChanged(entity.id, field.key, newVal);
            }
          });
        }
      });
    }

    /**
     * Render point list for spline / polyline entities.
     */
    _renderPointList(container, entity) {
      var self = this;
      var points = entity.points || [];

      // Point count (read-only)
      var countInput = createNumberInput(points.length);
      container.appendChild(createPropRow("Points", countInput, true));

      // Individual point coordinates
      points.forEach(function (pt, idx) {
        var xInput = createNumberInput(pt.x);
        container.appendChild(createPropRow("P" + idx + " X", xInput));
        xInput.addEventListener("change", function () {
          var newVal = parseFloat(xInput.value);
          if (!isNaN(newVal) && typeof self.onPropertyChanged === "function") {
            self.onPropertyChanged(entity.id, "points[" + idx + "].x", newVal);
          }
        });

        var yInput = createNumberInput(pt.y);
        container.appendChild(createPropRow("P" + idx + " Y", yInput));
        yInput.addEventListener("change", function () {
          var newVal = parseFloat(yInput.value);
          if (!isNaN(newVal) && typeof self.onPropertyChanged === "function") {
            self.onPropertyChanged(entity.id, "points[" + idx + "].y", newVal);
          }
        });
      });
    }

    /**
     * Render layer selector dropdown.
     */
    _renderLayerSelector(container, entity) {
      var self = this;
      var select = document.createElement("select");

      // Populate with available layers
      var layers = this._layers.length > 0 ? this._layers : [{ id: "default", name: "Default" }];

      layers.forEach(function (layer) {
        var option = document.createElement("option");
        option.value = layer.id;
        option.textContent = layer.name;
        if (entity.layer === layer.id) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      select.addEventListener("change", function () {
        if (typeof self.onPropertyChanged === "function") {
          self.onPropertyChanged(entity.id, "layer", select.value);
        }
      });

      container.appendChild(createPropRow("Layer", select));
    }

    // ───────────── multiple selection ─────────────

    /**
     * Show summary for multiple selected entities.
     * @param {Object[]} entities
     */
    showMultipleSelection(entities) {
      var container = document.getElementById(this._contentId);
      if (!container) return;

      this._clear(container);
      this._currentEntityId = null;

      // Count
      var countInput = createNumberInput(entities.length);
      container.appendChild(createPropRow("Selected", countInput, true));

      // Determine common type
      var types = {};
      entities.forEach(function (e) {
        var t = e.type || "unknown";
        types[t] = (types[t] || 0) + 1;
      });

      var typeKeys = Object.keys(types);
      var typeText = typeKeys.length === 1
        ? typeKeys[0] + " (" + entities.length + ")"
        : typeKeys.map(function (t) { return t + ": " + types[t]; }).join(", ");

      var typeInput = createTextInput(typeText);
      container.appendChild(createPropRow("Types", typeInput, true));

      // If all same type, show common editable fields
      if (typeKeys.length === 1) {
        var entityType = typeKeys[0].toLowerCase();
        var fields = ENTITY_FIELDS[entityType];
        if (fields) {
          this._renderCommonFields(container, entities, fields);
        }
      }
    }

    /**
     * Render fields common across multiple entities of the same type.
     * Edits apply to all selected entities.
     */
    _renderCommonFields(container, entities, fields) {
      var self = this;

      fields.forEach(function (field) {
        if (field.readOnly || field.compute) return;

        // Check if all entities share the same value
        var values = entities.map(function (e) { return e[field.key]; });
        var allSame = values.every(function (v) { return v === values[0]; });
        var displayValue = allSame ? values[0] : "";

        var input = createNumberInput(displayValue);
        if (!allSame) {
          input.placeholder = "mixed";
        }

        container.appendChild(createPropRow(field.label, input));

        input.addEventListener("change", function () {
          var newVal = parseFloat(input.value);
          if (isNaN(newVal)) return;
          if (typeof self.onPropertyChanged === "function") {
            entities.forEach(function (e) {
              self.onPropertyChanged(e.id, field.key, newVal);
            });
          }
        });
      });
    }

    // ───────────── clear ─────────────

    /**
     * Clear the properties panel.
     */
    clearProperties() {
      var container = document.getElementById(this._contentId);
      if (!container) return;

      this._clear(container);
      this._currentEntityId = null;

      var empty = document.createElement("p");
      empty.className = "prop-empty";
      empty.textContent = "No selection";
      container.appendChild(empty);
    }

    /** Internal clear helper */
    _clear(container) {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    // ───────────── parameters table ─────────────

    /**
     * Render the parameters table in the Parameters tab.
     * @param {Object[]} parameters  Array of { name, expression, value }
     */
    showParameters(parameters) {
      var container = document.getElementById(this._paramsTabId);
      if (!container) return;

      this._clear(container);

      var self = this;
      var params = parameters || [];

      if (params.length === 0) {
        var empty = document.createElement("p");
        empty.className = "empty-list";
        empty.textContent = "No parameters defined";
        container.appendChild(empty);
      } else {
        params.forEach(function (param, idx) {
          self._renderParameterRow(container, param, idx, params);
        });
      }

      // Add parameter button
      var addBtn = document.createElement("button");
      addBtn.className = "tool-btn";
      addBtn.style.width = "100%";
      addBtn.style.height = "28px";
      addBtn.style.marginTop = "6px";
      addBtn.style.border = "1px solid var(--border)";
      addBtn.style.borderRadius = "3px";
      addBtn.style.color = "var(--text-primary)";
      addBtn.style.background = "var(--bg-input)";
      addBtn.style.cursor = "pointer";
      addBtn.style.fontSize = "12px";
      addBtn.textContent = "+ Add Parameter";
      addBtn.addEventListener("click", function () {
        var newParams = params.slice();
        newParams.push({ name: "param_" + (newParams.length + 1), expression: "0", value: 0 });
        self.showParameters(newParams);
        self._notifyParameterChanged(newParams);
      });
      container.appendChild(addBtn);
    }

    /**
     * Render a single parameter row.
     */
    _renderParameterRow(container, param, idx, allParams) {
      var self = this;

      var row = document.createElement("div");
      row.className = "param-row";

      // Name input
      var nameInput = document.createElement("input");
      nameInput.className = "param-input";
      nameInput.type = "text";
      nameInput.value = param.name || "";
      nameInput.style.width = "auto";
      nameInput.style.flex = "1";
      nameInput.style.textAlign = "left";
      nameInput.style.marginRight = "4px";
      nameInput.addEventListener("change", function () {
        param.name = nameInput.value;
        self._notifyParameterChanged(allParams);
      });
      row.appendChild(nameInput);

      // Expression input
      var exprInput = document.createElement("input");
      exprInput.className = "param-input";
      exprInput.type = "text";
      exprInput.value = param.expression !== undefined ? String(param.expression) : "";
      exprInput.style.width = "60px";
      exprInput.style.marginRight = "4px";
      exprInput.addEventListener("change", function () {
        param.expression = exprInput.value;
        // Try to evaluate simple numeric expressions
        var numVal = parseFloat(exprInput.value);
        if (!isNaN(numVal)) {
          param.value = numVal;
          valSpan.textContent = String(numVal);
        }
        self._notifyParameterChanged(allParams);
      });
      row.appendChild(exprInput);

      // Computed value (read-only display)
      var valSpan = document.createElement("span");
      valSpan.className = "c-value";
      valSpan.textContent = param.value !== undefined ? String(param.value) : "";
      valSpan.style.width = "40px";
      valSpan.style.textAlign = "right";
      valSpan.style.marginRight = "4px";
      row.appendChild(valSpan);

      // Delete button
      var deleteBtn = document.createElement("span");
      deleteBtn.className = "c-remove";
      deleteBtn.textContent = "\u00D7";
      deleteBtn.style.visibility = "visible";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.addEventListener("click", function () {
        var newParams = allParams.slice();
        newParams.splice(idx, 1);
        self.showParameters(newParams);
        self._notifyParameterChanged(newParams);
      });
      row.appendChild(deleteBtn);

      container.appendChild(row);
    }

    /** Notify parameter change callback */
    _notifyParameterChanged(params) {
      if (typeof this.onParameterChanged === "function") {
        this.onParameterChanged(params);
      }
    }

    // ───────────── layers ─────────────

    /**
     * Set available layers for the layer selector dropdown.
     * @param {Array<{id: string, name: string}>} layers
     */
    setLayers(layers) {
      this._layers = layers || [];
    }
  }

  // ───────────── attach to window ─────────────
  window.PropertiesPanel = PropertiesPanel;
})();
