/**
 * layers.js - Layer management for the parametric 2D sketcher
 */

(function () {
  'use strict';

  var _nextId = 1;

  function generateLayerId() {
    return 'layer_' + (_nextId++);
  }

  // -------------------------------------------------------------------------
  // LayerManager
  // -------------------------------------------------------------------------

  class LayerManager {
    constructor() {
      var defaultLayer = {
        id: 'default',
        name: 'Layer 0',
        color: '#ffffff',
        visible: true,
        locked: false,
        lineStyle: 'solid'
      };

      this._layers = [defaultLayer];
      this._activeLayerId = 'default';
      this.entityLayerMap = {}; // entityId -> layerId

      /** Optional callback invoked whenever a layer property changes. */
      this.onLayerChanged = null;
    }

    // -- internal helpers ---------------------------------------------------

    _fireChanged() {
      if (typeof this.onLayerChanged === 'function') {
        this.onLayerChanged();
      }
    }

    // -- layer CRUD ---------------------------------------------------------

    /**
     * Create a new layer.
     * @param {string} name
     * @param {string} color - CSS colour string
     * @returns {Object} the newly created layer
     */
    addLayer(name, color) {
      var layer = {
        id: generateLayerId(),
        name: name || 'New Layer',
        color: color || '#cccccc',
        visible: true,
        locked: false,
        lineStyle: 'solid'
      };
      this._layers.push(layer);
      this._fireChanged();
      return layer;
    }

    /**
     * Remove a layer. Cannot remove the default layer.
     * Entities on the removed layer are moved to the default layer.
     * @param {string} layerId
     */
    removeLayer(layerId) {
      if (layerId === 'default') return;

      var idx = this._layers.findIndex(function (l) { return l.id === layerId; });
      if (idx === -1) return;

      this._layers.splice(idx, 1);

      // reassign entities
      var map = this.entityLayerMap;
      for (var eid in map) {
        if (Object.prototype.hasOwnProperty.call(map, eid) && map[eid] === layerId) {
          map[eid] = 'default';
        }
      }

      if (this._activeLayerId === layerId) {
        this._activeLayerId = 'default';
      }

      this._fireChanged();
    }

    /**
     * @param {string} layerId
     * @returns {Object|undefined}
     */
    getLayer(layerId) {
      return this._layers.find(function (l) { return l.id === layerId; });
    }

    /** @returns {Array} all layers (shallow copy) */
    getLayers() {
      return this._layers.slice();
    }

    /**
     * Set the active layer (where new entities are placed).
     * @param {string} layerId
     */
    setActiveLayer(layerId) {
      if (this.getLayer(layerId)) {
        this._activeLayerId = layerId;
        this._fireChanged();
      }
    }

    /** @returns {Object} the currently active layer */
    getActiveLayer() {
      return this.getLayer(this._activeLayerId);
    }

    // -- layer property helpers ---------------------------------------------

    toggleVisibility(layerId) {
      var layer = this.getLayer(layerId);
      if (layer) {
        layer.visible = !layer.visible;
        this._fireChanged();
      }
    }

    toggleLock(layerId) {
      var layer = this.getLayer(layerId);
      if (layer) {
        layer.locked = !layer.locked;
        this._fireChanged();
      }
    }

    setLayerColor(layerId, color) {
      var layer = this.getLayer(layerId);
      if (layer) {
        layer.color = color;
        this._fireChanged();
      }
    }

    /**
     * @param {string} layerId
     * @param {string} style - 'solid' | 'dashed' | 'dotted'
     */
    setLayerLineStyle(layerId, style) {
      var layer = this.getLayer(layerId);
      if (layer && (style === 'solid' || style === 'dashed' || style === 'dotted')) {
        layer.lineStyle = style;
        this._fireChanged();
      }
    }

    // -- entity-layer mapping -----------------------------------------------

    /**
     * Return which layer an entity belongs to.
     * Defaults to 'default' if not explicitly mapped.
     * @param {*} entityId
     * @returns {Object}
     */
    getEntityLayer(entityId) {
      var layerId = this.entityLayerMap[entityId] || 'default';
      return this.getLayer(layerId);
    }

    /**
     * Move an entity to a different layer.
     * @param {*} entityId
     * @param {string} layerId
     */
    setEntityLayer(entityId, layerId) {
      if (this.getLayer(layerId)) {
        this.entityLayerMap[entityId] = layerId;
        this._fireChanged();
      }
    }

    // -- UI rendering -------------------------------------------------------

    /**
     * Render the layer panel into the given container element.
     * @param {string} containerId - id of the DOM element to render into
     */
    renderLayerPanel(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var self = this;

      // clear previous contents
      container.innerHTML = '';

      // wrapper
      var panel = document.createElement('div');
      panel.className = 'layer-panel';
      panel.style.cssText = 'font-family:sans-serif;font-size:13px;user-select:none;';

      // header
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;margin-bottom:4px;border-bottom:1px solid #555;';
      var title = document.createElement('span');
      title.textContent = 'Layers';
      title.style.fontWeight = 'bold';
      header.appendChild(title);

      var addBtn = document.createElement('button');
      addBtn.textContent = '+ Add';
      addBtn.title = 'Add layer';
      addBtn.style.cssText = 'cursor:pointer;padding:2px 6px;font-size:12px;';
      addBtn.addEventListener('click', function () {
        var name = 'Layer ' + self._layers.length;
        self.addLayer(name, '#cccccc');
        self.renderLayerPanel(containerId);
      });
      header.appendChild(addBtn);
      panel.appendChild(header);

      // layer rows
      var layers = this.getLayers();
      for (var i = 0; i < layers.length; i++) {
        (function (layer) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer;border-radius:3px;';
          if (layer.id === self._activeLayerId) {
            row.style.background = 'rgba(100,150,255,0.25)';
          }

          // click row to set active
          row.addEventListener('click', function () {
            self.setActiveLayer(layer.id);
            self.renderLayerPanel(containerId);
          });

          // visibility eye
          var eyeBtn = document.createElement('span');
          eyeBtn.textContent = layer.visible ? '\u{1F441}' : '\u2014';
          eyeBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
          eyeBtn.style.cssText = 'cursor:pointer;width:18px;text-align:center;';
          eyeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            self.toggleVisibility(layer.id);
            self.renderLayerPanel(containerId);
          });
          row.appendChild(eyeBtn);

          // lock icon
          var lockBtn = document.createElement('span');
          lockBtn.textContent = layer.locked ? '\u{1F512}' : '\u{1F513}';
          lockBtn.title = layer.locked ? 'Unlock layer' : 'Lock layer';
          lockBtn.style.cssText = 'cursor:pointer;width:18px;text-align:center;';
          lockBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            self.toggleLock(layer.id);
            self.renderLayerPanel(containerId);
          });
          row.appendChild(lockBtn);

          // color swatch
          var swatch = document.createElement('span');
          swatch.style.cssText = 'display:inline-block;width:14px;height:14px;border:1px solid #888;border-radius:2px;background:' + layer.color + ';';
          row.appendChild(swatch);

          // name
          var nameSpan = document.createElement('span');
          nameSpan.textContent = layer.name;
          nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          row.appendChild(nameSpan);

          // active indicator
          if (layer.id === self._activeLayerId) {
            var activeInd = document.createElement('span');
            activeInd.textContent = '\u2713';
            activeInd.title = 'Active layer';
            activeInd.style.cssText = 'color:#6af;font-weight:bold;';
            row.appendChild(activeInd);
          }

          // delete button (disabled for default)
          var delBtn = document.createElement('button');
          delBtn.textContent = '\u00D7';
          delBtn.title = 'Delete layer';
          delBtn.style.cssText = 'cursor:pointer;padding:0 4px;font-size:14px;line-height:1;border:none;background:transparent;color:#ccc;';
          if (layer.id === 'default') {
            delBtn.disabled = true;
            delBtn.style.opacity = '0.3';
            delBtn.style.cursor = 'default';
          } else {
            delBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              self.removeLayer(layer.id);
              self.renderLayerPanel(containerId);
            });
          }
          row.appendChild(delBtn);

          panel.appendChild(row);
        })(layers[i]);
      }

      container.appendChild(panel);
    }
  }

  // -------------------------------------------------------------------------
  // Expose on window
  // -------------------------------------------------------------------------

  window.LayerManager = LayerManager;
})();
