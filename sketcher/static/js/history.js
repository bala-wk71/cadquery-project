/**
 * history.js - Undo/Redo manager using the Command pattern
 */

(function () {
  'use strict';

  const MAX_HISTORY = 100;

  // -------------------------------------------------------------------------
  // HistoryManager
  // -------------------------------------------------------------------------

  class HistoryManager {
    constructor() {
      this._undoStack = [];
      this._redoStack = [];
      this._maxSize = MAX_HISTORY;
    }

    /**
     * Execute a command, push it onto the undo stack, and clear the redo stack.
     * @param {Object} command  Must implement { description, execute, undo, redo }
     */
    execute(command) {
      command.execute();
      this._undoStack.push(command);
      if (this._undoStack.length > this._maxSize) {
        this._undoStack.shift();
      }
      this._redoStack.length = 0;
    }

    /** Undo the most recent command. */
    undo() {
      if (!this.canUndo()) return;
      const command = this._undoStack.pop();
      command.undo();
      this._redoStack.push(command);
    }

    /** Redo the most recently undone command. */
    redo() {
      if (!this.canRedo()) return;
      const command = this._redoStack.pop();
      command.redo();
      this._undoStack.push(command);
      if (this._undoStack.length > this._maxSize) {
        this._undoStack.shift();
      }
    }

    canUndo() {
      return this._undoStack.length > 0;
    }

    canRedo() {
      return this._redoStack.length > 0;
    }

    /** Clear both stacks. */
    clear() {
      this._undoStack.length = 0;
      this._redoStack.length = 0;
    }

    /** @returns {string|null} Description of the next undo action, or null. */
    getUndoDescription() {
      if (!this.canUndo()) return null;
      return this._undoStack[this._undoStack.length - 1].description;
    }

    /** @returns {string|null} Description of the next redo action, or null. */
    getRedoDescription() {
      if (!this.canRedo()) return null;
      return this._redoStack[this._redoStack.length - 1].description;
    }
  }

  // -------------------------------------------------------------------------
  // Command factory functions
  // -------------------------------------------------------------------------

  /**
   * Add an entity to the sketch.
   * @param {Object} sketch  - sketch data object with `entities` array
   * @param {Object} entity  - the entity to add
   */
  function AddEntityCommand(sketch, entity) {
    return {
      description: 'Add entity',
      execute: function () {
        sketch.entities.push(entity);
      },
      undo: function () {
        const idx = sketch.entities.indexOf(entity);
        if (idx !== -1) sketch.entities.splice(idx, 1);
      },
      redo: function () {
        sketch.entities.push(entity);
      }
    };
  }

  /**
   * Delete an entity from the sketch by id.
   * @param {Object} sketch    - sketch data object with `entities` array
   * @param {*}      entityId  - id of the entity to remove
   */
  function DeleteEntityCommand(sketch, entityId) {
    var stored = null;
    var storedIndex = -1;

    return {
      description: 'Delete entity',
      execute: function () {
        var idx = sketch.entities.findIndex(function (e) { return e.id === entityId; });
        if (idx !== -1) {
          stored = JSON.parse(JSON.stringify(sketch.entities[idx]));
          storedIndex = idx;
          sketch.entities.splice(idx, 1);
        }
      },
      undo: function () {
        if (stored) {
          sketch.entities.splice(storedIndex, 0, JSON.parse(JSON.stringify(stored)));
        }
      },
      redo: function () {
        var idx = sketch.entities.findIndex(function (e) { return e.id === entityId; });
        if (idx !== -1) sketch.entities.splice(idx, 1);
      }
    };
  }

  /**
   * Move an entity by (dx, dy).
   * Assumes entity has numeric `x` and `y` properties.
   * @param {Object} sketch    - sketch data object
   * @param {*}      entityId  - id of the entity
   * @param {number} dx        - horizontal offset
   * @param {number} dy        - vertical offset
   */
  function MoveEntityCommand(sketch, entityId, dx, dy) {
    function find() {
      return sketch.entities.find(function (e) { return e.id === entityId; });
    }

    return {
      description: 'Move entity',
      execute: function () {
        var ent = find();
        if (ent) { ent.x += dx; ent.y += dy; }
      },
      undo: function () {
        var ent = find();
        if (ent) { ent.x -= dx; ent.y -= dy; }
      },
      redo: function () {
        var ent = find();
        if (ent) { ent.x += dx; ent.y += dy; }
      }
    };
  }

  /**
   * Modify arbitrary properties on an entity.
   * @param {Object} sketch    - sketch data object
   * @param {*}      entityId  - id of the entity
   * @param {Object} oldProps  - previous property values (keys to restore)
   * @param {Object} newProps  - new property values (keys to apply)
   */
  function ModifyEntityCommand(sketch, entityId, oldProps, newProps) {
    function find() {
      return sketch.entities.find(function (e) { return e.id === entityId; });
    }

    function applyProps(ent, props) {
      for (var key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          ent[key] = props[key];
        }
      }
    }

    return {
      description: 'Modify entity',
      execute: function () {
        var ent = find();
        if (ent) applyProps(ent, newProps);
      },
      undo: function () {
        var ent = find();
        if (ent) applyProps(ent, oldProps);
      },
      redo: function () {
        var ent = find();
        if (ent) applyProps(ent, newProps);
      }
    };
  }

  /**
   * Add a constraint to the sketch.
   * @param {Object} sketch     - sketch data object with `constraints` array
   * @param {Object} constraint - constraint to add
   */
  function AddConstraintCommand(sketch, constraint) {
    return {
      description: 'Add constraint',
      execute: function () {
        sketch.constraints.push(constraint);
      },
      undo: function () {
        var idx = sketch.constraints.indexOf(constraint);
        if (idx !== -1) sketch.constraints.splice(idx, 1);
      },
      redo: function () {
        sketch.constraints.push(constraint);
      }
    };
  }

  /**
   * Delete a constraint from the sketch by id.
   * @param {Object} sketch       - sketch data object with `constraints` array
   * @param {*}      constraintId - id of the constraint to remove
   */
  function DeleteConstraintCommand(sketch, constraintId) {
    var stored = null;
    var storedIndex = -1;

    return {
      description: 'Delete constraint',
      execute: function () {
        var idx = sketch.constraints.findIndex(function (c) { return c.id === constraintId; });
        if (idx !== -1) {
          stored = JSON.parse(JSON.stringify(sketch.constraints[idx]));
          storedIndex = idx;
          sketch.constraints.splice(idx, 1);
        }
      },
      undo: function () {
        if (stored) {
          sketch.constraints.splice(storedIndex, 0, JSON.parse(JSON.stringify(stored)));
        }
      },
      redo: function () {
        var idx = sketch.constraints.findIndex(function (c) { return c.id === constraintId; });
        if (idx !== -1) sketch.constraints.splice(idx, 1);
      }
    };
  }

  /**
   * Group multiple commands into a single undoable step.
   * @param {Array}  commands    - array of command objects
   * @param {string} description - description for the composite
   */
  function CompositeCommand(commands, description) {
    return {
      description: description || 'Composite action',
      execute: function () {
        for (var i = 0; i < commands.length; i++) {
          commands[i].execute();
        }
      },
      undo: function () {
        for (var i = commands.length - 1; i >= 0; i--) {
          commands[i].undo();
        }
      },
      redo: function () {
        for (var i = 0; i < commands.length; i++) {
          commands[i].redo();
        }
      }
    };
  }

  // -------------------------------------------------------------------------
  // Expose on window
  // -------------------------------------------------------------------------

  window.HistoryManager = HistoryManager;
  window.AddEntityCommand = AddEntityCommand;
  window.DeleteEntityCommand = DeleteEntityCommand;
  window.MoveEntityCommand = MoveEntityCommand;
  window.ModifyEntityCommand = ModifyEntityCommand;
  window.AddConstraintCommand = AddConstraintCommand;
  window.DeleteConstraintCommand = DeleteConstraintCommand;
  window.CompositeCommand = CompositeCommand;
})();
