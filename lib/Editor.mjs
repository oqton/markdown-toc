// Copied from https://github.com/atom/atom/blob/master/src/text-editor.js
import _ from "underscore";
import path from "path";
import TextBuffer from "text-buffer";

const {Point, Range} = TextBuffer;


const SERIALIZATION_VERSION = 1;
const NON_WHITESPACE_REGEXP = /\S/;
const DEFAULT_NON_WORD_CHARACTERS = '/\\()"\':,.;<>~!@#$%^&*|+=[]{}`?-…';
let nextId = 0;

class TextEditor {
  constructor() {
    this.emitter = {emit:()=>{}}
    
    const params = {};
    
        this.id = params.id != null ? params.id : nextId++;
        if (this.id >= nextId) {
          // Ensure that new editors get unique ids:
          nextId = this.id + 1;
        }
        this.initialScrollTopRow = params.initialScrollTopRow;
        this.initialScrollLeftColumn = params.initialScrollLeftColumn;
        this.decorationManager = params.decorationManager;
        this.selectionsMarkerLayer = params.selectionsMarkerLayer;
        this.mini = params.mini != null ? params.mini : false;
        this.keyboardInputEnabled =
          params.keyboardInputEnabled != null ? params.keyboardInputEnabled : true;
        this.readOnly = params.readOnly != null ? params.readOnly : false;
        this.placeholderText = params.placeholderText;
        this.showLineNumbers = params.showLineNumbers;
        this.assert = params.assert || (condition => condition);
        this.showInvisibles =
          params.showInvisibles != null ? params.showInvisibles : true;
        this.autoHeight = params.autoHeight;
        this.autoWidth = params.autoWidth;
        this.scrollPastEnd =
          params.scrollPastEnd != null ? params.scrollPastEnd : false;
        this.scrollSensitivity =
          params.scrollSensitivity != null ? params.scrollSensitivity : 40;
        this.editorWidthInChars = params.editorWidthInChars;
        this.invisibles = params.invisibles;
        this.showIndentGuide = params.showIndentGuide;
        this.softWrapped = params.softWrapped;
        this.softWrapAtPreferredLineLength = params.softWrapAtPreferredLineLength;
        this.preferredLineLength = params.preferredLineLength;
        this.showCursorOnSelection =
          params.showCursorOnSelection != null
            ? params.showCursorOnSelection
            : true;
        this.maxScreenLineLength = params.maxScreenLineLength;
        this.softTabs = params.softTabs != null ? params.softTabs : true;
        this.autoIndent = params.autoIndent != null ? params.autoIndent : true;
        this.autoIndentOnPaste =
          params.autoIndentOnPaste != null ? params.autoIndentOnPaste : true;
        this.undoGroupingInterval =
          params.undoGroupingInterval != null ? params.undoGroupingInterval : 300;
        this.softWrapped = params.softWrapped != null ? params.softWrapped : false;
        this.softWrapAtPreferredLineLength =
          params.softWrapAtPreferredLineLength != null
            ? params.softWrapAtPreferredLineLength
            : false;
        this.preferredLineLength =
          params.preferredLineLength != null ? params.preferredLineLength : 80;
        this.maxScreenLineLength =
          params.maxScreenLineLength != null ? params.maxScreenLineLength : 500;
        this.showLineNumbers =
          params.showLineNumbers != null ? params.showLineNumbers : true;

        this.alive = true;
        this.doBackgroundWork = this.doBackgroundWork.bind(this);
        this.serializationVersion = 1;
        this.suppressSelectionMerging = false;
        this.selectionFlashDuration = 500;
        this.gutterContainer = null;
        this.verticalScrollMargin = 2;
        this.horizontalScrollMargin = 6;
        this.lineHeightInPixels = null;
        this.defaultCharWidth = null;
        this.height = null;
        this.width = null;
        this.registered = false;
        this.atomicSoftTabs = true;
        this.cursors = [];
        this.cursorsByMarkerId = new Map();
        this.selections = [];
        this.hasTerminatedPendingState = false;

  }
  
  async load(source, params) {
    this.buffer = new TextBuffer(params);
    if (typeof source === "string") {
      this.buffer.setPath(source);
    } else {
      this.buffer.setFile(source);
    }
    return this.buffer
      .load({
        clearHistory: true,
        internal: true,
        mustExist: params && params.mustExist
      })
      .then(() => this.buffer)
      .catch(err => {
        this.buffer.destroy();
        throw err;
      });
  }
  
  /*
  Section: File Operations
  */

  // Essential: Saves the editor's text buffer.
  //
  // See {TextBuffer::save} for more details.
  save() {
    return this.buffer.save();
  }
  
  // Extended: Batch multiple operations as a single undo/redo step.
  //
  // Any group of operations that are logically grouped from the perspective of
  // undoing and redoing should be performed in a transaction. If you want to
  // abort the transaction, call {::abortTransaction} to terminate the function's
  // execution and revert any changes performed up to the abortion.
  //
  // * `groupingInterval` (optional) The {Number} of milliseconds for which this
  //   transaction should be considered 'groupable' after it begins. If a transaction
  //   with a positive `groupingInterval` is committed while the previous transaction is
  //   still 'groupable', the two transactions are merged with respect to undo and redo.
  // * `fn` A {Function} to call inside the transaction.
  transact(groupingInterval, fn) {
    const options = { selectionsMarkerLayer: this.selectionsMarkerLayer };
    return this.buffer.transact(options, fn);
  }

  get element() {
    return this.getElement();
  }


  get languageMode() {
    return this.buffer.getLanguageMode();
  }
  get tokenizedBuffer() {
    return this.buffer.getLanguageMode();
  }

  get rowsPerPage() {
    return this.getRowsPerPage();
  }

  decorateCursorLine() {
    this.cursorLineDecorations = [
      this.decorateMarkerLayer(this.selectionsMarkerLayer, {
        type: 'line',
        class: 'cursor-line',
        onlyEmpty: true
      }),
      this.decorateMarkerLayer(this.selectionsMarkerLayer, {
        type: 'line-number',
        class: 'cursor-line'
      }),
      this.decorateMarkerLayer(this.selectionsMarkerLayer, {
        type: 'line-number',
        class: 'cursor-line-no-selection',
        onlyHead: true,
        onlyEmpty: true
      })
    ];
  }

  doBackgroundWork(deadline) {
    const previousLongestRow = this.getApproximateLongestScreenRow();
    if (this.displayLayer.doBackgroundWork(deadline)) {
      this.backgroundWorkHandle = requestIdleCallback(this.doBackgroundWork);
    } else {
      this.backgroundWorkHandle = null;
    }

    if (
      this.component &&
      this.getApproximateLongestScreenRow() !== previousLongestRow
    ) {
      this.component.scheduleUpdate();
    }
  }

  update(params) {
    const displayLayerParams = {};

    for (let param of Object.keys(params)) {
      const value = params[param];

      switch (param) {
        case 'autoIndent':
          this.autoIndent = value;
          break;

        case 'autoIndentOnPaste':
          this.autoIndentOnPaste = value;
          break;

        case 'undoGroupingInterval':
          this.undoGroupingInterval = value;
          break;

        case 'scrollSensitivity':
          this.scrollSensitivity = value;
          break;

        case 'encoding':
          this.buffer.setEncoding(value);
          break;

        case 'softTabs':
          if (value !== this.softTabs) {
            this.softTabs = value;
          }
          break;

        case 'atomicSoftTabs':
          if (value !== this.displayLayer.atomicSoftTabs) {
            displayLayerParams.atomicSoftTabs = value;
          }
          break;

        case 'tabLength':
          if (value > 0 && value !== this.displayLayer.tabLength) {
            displayLayerParams.tabLength = value;
          }
          break;

        case 'softWrapped':
          if (value !== this.softWrapped) {
            this.softWrapped = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
            this.emitter.emit('did-change-soft-wrapped', this.isSoftWrapped());
          }
          break;

        case 'softWrapHangingIndentLength':
          if (value !== this.displayLayer.softWrapHangingIndent) {
            displayLayerParams.softWrapHangingIndent = value;
          }
          break;

        case 'softWrapAtPreferredLineLength':
          if (value !== this.softWrapAtPreferredLineLength) {
            this.softWrapAtPreferredLineLength = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
          }
          break;

        case 'preferredLineLength':
          if (value !== this.preferredLineLength) {
            this.preferredLineLength = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
          }
          break;

        case 'maxScreenLineLength':
          if (value !== this.maxScreenLineLength) {
            this.maxScreenLineLength = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
          }
          break;

        case 'mini':
          if (value !== this.mini) {
            this.mini = value;
            this.emitter.emit('did-change-mini', value);
            displayLayerParams.invisibles = this.getInvisibles();
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
            displayLayerParams.showIndentGuides = this.doesShowIndentGuide();
            if (this.mini) {
              for (let decoration of this.cursorLineDecorations) {
                decoration.destroy();
              }
              this.cursorLineDecorations = null;
            } else {
              this.decorateCursorLine();
            }
            if (this.component != null) {
              this.component.scheduleUpdate();
            }
          }
          break;

        case 'readOnly':
          if (value !== this.readOnly) {
            this.readOnly = value;
            if (this.component != null) {
              this.component.scheduleUpdate();
            }
          }
          break;

        case 'keyboardInputEnabled':
          if (value !== this.keyboardInputEnabled) {
            this.keyboardInputEnabled = value;
            if (this.component != null) {
              this.component.scheduleUpdate();
            }
          }
          break;

        case 'placeholderText':
          if (value !== this.placeholderText) {
            this.placeholderText = value;
            this.emitter.emit('did-change-placeholder-text', value);
          }
          break;

        case 'lineNumberGutterVisible':
          if (value !== this.lineNumberGutterVisible) {
            if (value) {
              this.lineNumberGutter.show();
            } else {
              this.lineNumberGutter.hide();
            }
            this.emitter.emit(
              'did-change-line-number-gutter-visible',
              this.lineNumberGutter.isVisible()
            );
          }
          break;

        case 'showIndentGuide':
          if (value !== this.showIndentGuide) {
            this.showIndentGuide = value;
            displayLayerParams.showIndentGuides = this.doesShowIndentGuide();
          }
          break;

        case 'showLineNumbers':
          if (value !== this.showLineNumbers) {
            this.showLineNumbers = value;
            if (this.component != null) {
              this.component.scheduleUpdate();
            }
          }
          break;

        case 'showInvisibles':
          if (value !== this.showInvisibles) {
            this.showInvisibles = value;
            displayLayerParams.invisibles = this.getInvisibles();
          }
          break;

        case 'invisibles':
          if (!_.isEqual(value, this.invisibles)) {
            this.invisibles = value;
            displayLayerParams.invisibles = this.getInvisibles();
          }
          break;

        case 'editorWidthInChars':
          if (value > 0 && value !== this.editorWidthInChars) {
            this.editorWidthInChars = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
          }
          break;

        case 'width':
          if (value !== this.width) {
            this.width = value;
            displayLayerParams.softWrapColumn = this.getSoftWrapColumn();
          }
          break;

        case 'scrollPastEnd':
          if (value !== this.scrollPastEnd) {
            this.scrollPastEnd = value;
            if (this.component) this.component.scheduleUpdate();
          }
          break;

        case 'autoHeight':
          if (value !== this.autoHeight) {
            this.autoHeight = value;
          }
          break;

        case 'autoWidth':
          if (value !== this.autoWidth) {
            this.autoWidth = value;
          }
          break;

        case 'showCursorOnSelection':
          if (value !== this.showCursorOnSelection) {
            this.showCursorOnSelection = value;
            if (this.component) this.component.scheduleUpdate();
          }
          break;

        default:
          if (param !== 'ref' && param !== 'key') {
            throw new TypeError(`Invalid TextEditor parameter: '${param}'`);
          }
      }
    }

    this.displayLayer.reset(displayLayerParams);

    if (this.component) {
      return this.component.getNextUpdatePromise();
    } else {
      return Promise.resolve();
    }
  }

  scheduleComponentUpdate() {
    if (this.component) this.component.scheduleUpdate();
  }

  serialize() {
    return {
      deserializer: 'TextEditor',
      version: SERIALIZATION_VERSION,

      displayLayerId: this.displayLayer.id,
      selectionsMarkerLayerId: this.selectionsMarkerLayer.id,

      initialScrollTopRow: this.getScrollTopRow(),
      initialScrollLeftColumn: this.getScrollLeftColumn(),

      tabLength: this.displayLayer.tabLength,
      atomicSoftTabs: this.displayLayer.atomicSoftTabs,
      softWrapHangingIndentLength: this.displayLayer.softWrapHangingIndent,

      id: this.id,
      bufferId: this.buffer.id,
      softTabs: this.softTabs,
      softWrapped: this.softWrapped,
      softWrapAtPreferredLineLength: this.softWrapAtPreferredLineLength,
      preferredLineLength: this.preferredLineLength,
      mini: this.mini,
      readOnly2: this.readOnly, // readOnly encompassed both readOnly and keyboardInputEnabled
      keyboardInputEnabled: this.keyboardInputEnabled,
      editorWidthInChars: this.editorWidthInChars,
      width: this.width,
      maxScreenLineLength: this.maxScreenLineLength,
      registered: this.registered,
      invisibles: this.invisibles,
      showInvisibles: this.showInvisibles,
      showIndentGuide: this.showIndentGuide,
      autoHeight: this.autoHeight,
      autoWidth: this.autoWidth
    };
  }

  subscribeToBuffer() {
    this.buffer.retain();
    this.disposables.add(
      this.buffer.onDidChangeLanguageMode(
        this.handleLanguageModeChange.bind(this)
      )
    );
    this.disposables.add(
      this.buffer.onDidChangePath(() => {
        this.emitter.emit('did-change-title', this.getTitle());
        this.emitter.emit('did-change-path', this.getPath());
      })
    );
    this.disposables.add(
      this.buffer.onDidChangeEncoding(() => {
        this.emitter.emit('did-change-encoding', this.getEncoding());
      })
    );
    this.disposables.add(this.buffer.onDidDestroy(() => this.destroy()));
    this.disposables.add(
      this.buffer.onDidChangeModified(() => {
        if (!this.hasTerminatedPendingState && this.buffer.isModified())
          this.terminatePendingState();
      })
    );
  }

  terminatePendingState() {
    if (!this.hasTerminatedPendingState)
      this.emitter.emit('did-terminate-pending-state');
    this.hasTerminatedPendingState = true;
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on('did-terminate-pending-state', callback);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.disposables.dispose();
    this.displayLayer.destroy();
    for (let selection of this.selections.slice()) {
      selection.destroy();
    }
    this.buffer.release();
    this.gutterContainer.destroy();
    this.emitter.emit('did-destroy');
    this.emitter.clear();
    if (this.component) this.component.element.component = null;
    this.component = null;
    this.lineNumberGutter.element = null;
  }

  isAlive() {
    return this.alive;
  }

  isDestroyed() {
    return !this.alive;
  }

  // Retrieves the current buffer's URI.
  getURI() {
    return this.buffer.getUri();
  }

  // Controls visibility based on the given {Boolean}.
  setVisible(visible) {
    if (visible) {
      const languageMode = this.buffer.getLanguageMode();
      if (languageMode.startTokenizing) languageMode.startTokenizing();
    }
  }

  setMini(mini) {
    this.update({ mini });
  }

  isMini() {
    return this.mini;
  }

  setReadOnly(readOnly) {
    this.update({ readOnly });
  }

  isReadOnly() {
    return this.readOnly;
  }

  enableKeyboardInput(enabled) {
    this.update({ keyboardInputEnabled: enabled });
  }

  isKeyboardInputEnabled() {
    return this.keyboardInputEnabled;
  }

  onDidChangeMini(callback) {
    return this.emitter.on('did-change-mini', callback);
  }

  setLineNumberGutterVisible(lineNumberGutterVisible) {
    this.update({ lineNumberGutterVisible });
  }

  isLineNumberGutterVisible() {
    return this.lineNumberGutter.isVisible();
  }

  anyLineNumberGutterVisible() {
    return this.getGutters().some(
      gutter => gutter.type === 'line-number' && gutter.visible
    );
  }

  onDidChangeLineNumberGutterVisible(callback) {
    return this.emitter.on('did-change-line-number-gutter-visible', callback);
  }

  // Essential: Calls your `callback` when a {Gutter} is added to the editor.
  // Immediately calls your callback for each existing gutter.
  //
  // * `callback` {Function}
  //   * `gutter` {Gutter} that currently exists/was added.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observeGutters(callback) {
    return this.gutterContainer.observeGutters(callback);
  }

  // Essential: Calls your `callback` when a {Gutter} is added to the editor.
  //
  // * `callback` {Function}
  //   * `gutter` {Gutter} that was added.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidAddGutter(callback) {
    return this.gutterContainer.onDidAddGutter(callback);
  }

  // Essential: Calls your `callback` when a {Gutter} is removed from the editor.
  //
  // * `callback` {Function}
  //   * `name` The name of the {Gutter} that was removed.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidRemoveGutter(callback) {
    return this.gutterContainer.onDidRemoveGutter(callback);
  }

  // Set the number of characters that can be displayed horizontally in the
  // editor.
  //
  // * `editorWidthInChars` A {Number} representing the width of the
  // {TextEditorElement} in characters.
  setEditorWidthInChars(editorWidthInChars) {
    this.update({ editorWidthInChars });
  }

  // Returns the editor width in characters.
  getEditorWidthInChars() {
    if (this.width != null && this.defaultCharWidth > 0) {
      return Math.max(0, Math.floor(this.width / this.defaultCharWidth));
    } else {
      return this.editorWidthInChars;
    }
  }

  /*
  Section: Buffer
  */

  // Essential: Retrieves the current {TextBuffer}.
  getBuffer() {
    return this.buffer;
  }

  /*
  Section: File Details
  */

  // Essential: Get the editor's title for display in other parts of the
  // UI such as the tabs.
  //
  // If the editor's buffer is saved, its title is the file name. If it is
  // unsaved, its title is "untitled".
  //
  // Returns a {String}.
  getTitle() {
    return this.getFileName() || 'untitled';
  }

  // Essential: Returns the {String} path of this editor's text buffer.
  getPath() {
    return this.buffer.getPath();
  }

  getFileName() {
    const fullPath = this.getPath();
    if (fullPath) return path.basename(fullPath);
  }

  getDirectoryPath() {
    const fullPath = this.getPath();
    if (fullPath) return path.dirname(fullPath);
  }

  // Extended: Returns the {String} character set encoding of this editor's text
  // buffer.
  getEncoding() {
    return this.buffer.getEncoding();
  }

  // Extended: Set the character set encoding to use in this editor's text
  // buffer.
  //
  // * `encoding` The {String} character set encoding name such as 'utf8'
  setEncoding(encoding) {
    this.buffer.setEncoding(encoding);
  }

  // Essential: Returns {Boolean} `true` if this editor has been modified.
  isModified() {
    return this.buffer.isModified();
  }

  // Essential: Returns {Boolean} `true` if this editor has no content.
  isEmpty() {
    return this.buffer.isEmpty();
  }

  /*
  Section: Reading Text
  */

  // Essential: Returns a {String} representing the entire contents of the editor.
  getText() {
    return this.buffer.getText();
  }

  // Essential: Get the text in the given {Range} in buffer coordinates.
  //
  // * `range` A {Range} or range-compatible {Array}.
  //
  // Returns a {String}.
  getTextInBufferRange(range) {
    return this.buffer.getTextInRange(range);
  }

  // Essential: Returns a {Number} representing the number of lines in the buffer.
  getLineCount() {
    return this.buffer.getLineCount();
  }

  // Essential: Returns a {Number} representing the number of screen lines in the
  // editor. This accounts for folds.
  getScreenLineCount() {
    return this.displayLayer.getScreenLineCount();
  }

  getApproximateScreenLineCount() {
    return this.displayLayer.getApproximateScreenLineCount();
  }

  // Essential: Returns a {Number} representing the last zero-indexed buffer row
  // number of the editor.
  getLastBufferRow() {
    return this.buffer.getLastRow();
  }

  // Essential: Returns a {Number} representing the last zero-indexed screen row
  // number of the editor.
  getLastScreenRow() {
    return this.getScreenLineCount() - 1;
  }

  // Essential: Returns a {String} representing the contents of the line at the
  // given buffer row.
  //
  // * `bufferRow` A {Number} representing a zero-indexed buffer row.
  lineTextForBufferRow(bufferRow) {
    return this.buffer.lineForRow(bufferRow);
  }

  // Essential: Returns a {String} representing the contents of the line at the
  // given screen row.
  //
  // * `screenRow` A {Number} representing a zero-indexed screen row.
  lineTextForScreenRow(screenRow) {
    const screenLine = this.screenLineForScreenRow(screenRow);
    if (screenLine) return screenLine.lineText;
  }

  logScreenLines(start = 0, end = this.getLastScreenRow()) {
    for (let row = start; row <= end; row++) {
      const line = this.lineTextForScreenRow(row);
      console.log(row, this.bufferRowForScreenRow(row), line, line.length);
    }
  }

  tokensForScreenRow(screenRow) {
    const tokens = [];
    let lineTextIndex = 0;
    const currentTokenScopes = [];
    const { lineText, tags } = this.screenLineForScreenRow(screenRow);
    for (const tag of tags) {
      if (this.displayLayer.isOpenTag(tag)) {
        currentTokenScopes.push(this.displayLayer.classNameForTag(tag));
      } else if (this.displayLayer.isCloseTag(tag)) {
        currentTokenScopes.pop();
      } else {
        tokens.push({
          text: lineText.substr(lineTextIndex, tag),
          scopes: currentTokenScopes.slice()
        });
        lineTextIndex += tag;
      }
    }
    return tokens;
  }

  screenLineForScreenRow(screenRow) {
    return this.displayLayer.getScreenLine(screenRow);
  }

  bufferRowForScreenRow(screenRow) {
    return this.displayLayer.translateScreenPosition(Point(screenRow, 0)).row;
  }

  bufferRowsForScreenRows(startScreenRow, endScreenRow) {
    return this.displayLayer.bufferRowsForScreenRows(
      startScreenRow,
      endScreenRow + 1
    );
  }

  screenRowForBufferRow(row) {
    return this.displayLayer.translateBufferPosition(Point(row, 0)).row;
  }

  getRightmostScreenPosition() {
    return this.displayLayer.getRightmostScreenPosition();
  }

  getApproximateRightmostScreenPosition() {
    return this.displayLayer.getApproximateRightmostScreenPosition();
  }

  getMaxScreenLineLength() {
    return this.getRightmostScreenPosition().column;
  }

  getLongestScreenRow() {
    return this.getRightmostScreenPosition().row;
  }

  getApproximateLongestScreenRow() {
    return this.getApproximateRightmostScreenPosition().row;
  }

  lineLengthForScreenRow(screenRow) {
    return this.displayLayer.lineLengthForScreenRow(screenRow);
  }

  // Returns the range for the given buffer row.
  //
  // * `row` A row {Number}.
  // * `options` (optional) An options hash with an `includeNewline` key.
  //
  // Returns a {Range}.
  bufferRangeForBufferRow(row, options) {
    return this.buffer.rangeForRow(row, options && options.includeNewline);
  }

  // Get the text in the given {Range}.
  //
  // Returns a {String}.
  getTextInRange(range) {
    return this.buffer.getTextInRange(range);
  }

  // {Delegates to: TextBuffer.isRowBlank}
  isBufferRowBlank(bufferRow) {
    return this.buffer.isRowBlank(bufferRow);
  }

  // {Delegates to: TextBuffer.nextNonBlankRow}
  nextNonBlankBufferRow(bufferRow) {
    return this.buffer.nextNonBlankRow(bufferRow);
  }

  // {Delegates to: TextBuffer.getEndPosition}
  getEofBufferPosition() {
    return this.buffer.getEndPosition();
  }

  // Essential: Get the {Range} of the paragraph surrounding the most recently added
  // cursor.
  //
  // Returns a {Range}.
  getCurrentParagraphBufferRange() {
    return this.getLastCursor().getCurrentParagraphBufferRange();
  }

  /*
  Section: Mutating Text
  */

  // Essential: Replaces the entire contents of the buffer with the given {String}.
  //
  // * `text` A {String} to replace with
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor.
  setText(text, options = {}) {
    if (!this.ensureWritable('setText', options)) return;
    return this.buffer.setText(text);
  }

  // Essential: Set the text in the given {Range} in buffer coordinates.
  //
  // * `range` A {Range} or range-compatible {Array}.
  // * `text` A {String}
  // * `options` (optional) {Object}
  //   * `normalizeLineEndings` (optional) {Boolean} (default: true)
  //   * `undo` (optional) *Deprecated* {String} 'skip' will skip the undo system. This property is deprecated. Call groupLastChanges() on the {TextBuffer} afterward instead.
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  //
  // Returns the {Range} of the newly-inserted text.
  setTextInBufferRange(range, text, options = {}) {
    if (!this.ensureWritable('setTextInBufferRange', options)) return;
    return this.getBuffer().setTextInRange(range, text, options);
  }

  // Essential: For each selection, replace the selected text with the given text.
  //
  // * `text` A {String} representing the text to insert.
  // * `options` (optional) See {Selection::insertText}.
  //
  // Returns a {Range} when the text has been inserted. Returns a {Boolean} `false` when the text has not been inserted.
  insertText(text, options = {}) {
    if (!this.ensureWritable('insertText', options)) return;
    if (!this.emitWillInsertTextEvent(text)) return false;

    let groupLastChanges = false;
    if (options.undo === 'skip') {
      options = Object.assign({}, options);
      delete options.undo;
      groupLastChanges = true;
    }

    const groupingInterval = options.groupUndo ? this.undoGroupingInterval : 0;
    if (options.autoIndentNewline == null)
      options.autoIndentNewline = this.shouldAutoIndent();
    if (options.autoDecreaseIndent == null)
      options.autoDecreaseIndent = this.shouldAutoIndent();
    // const result = this.mutateSelectedText(selection => {
    //   const range = selection.insertText(text, options);
    //   const didInsertEvent = { text, range };
    //   this.emitter.emit('did-insert-text', didInsertEvent);
    //   return range;
    // }, groupingInterval);
    // this.buffer.setTextInRange(
    //   oldBufferRange,
    //   text,
    //   pick(options, 'undo', 'normalizeLineEndings')
    // );
    this.buffer.setText(text);
    if (groupLastChanges) this.buffer.groupLastChanges();
    // return result;
  }

  // Essential: For each selection, replace the selected text with a newline.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  insertNewline(options = {}) {
    return this.insertText('\n', options);
  }

  // Essential: For each selection, if the selection is empty, delete the character
  // following the cursor. Otherwise delete the selected text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  delete(options = {}) {
    if (!this.ensureWritable('delete', options)) return;
    return this.mutateSelectedText(selection => selection.delete(options));
  }

  // Essential: For each selection, if the selection is empty, delete the character
  // preceding the cursor. Otherwise delete the selected text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  backspace(options = {}) {
    if (!this.ensureWritable('backspace', options)) return;
    return this.mutateSelectedText(selection => selection.backspace(options));
  }

  // // Extended: Mutate the text of all the selections in a single transaction.
  // //
  // // All the changes made inside the given {Function} can be reverted with a
  // // single call to {::undo}.
  // //
  // // * `fn` A {Function} that will be called once for each {Selection}. The first
  // //      argument will be a {Selection} and the second argument will be the
  // //      {Number} index of that selection.
  mutateSelectedText(fn, groupingInterval = 0) {
    // return this.mergeIntersectingSelections(() => {
      return this.transact(groupingInterval, () => {
        return this.getSelectionsOrderedByBufferPosition().map(
          (selection, index) => fn(selection, index)
        );
      });
    // });
  }

  // Move lines intersecting the most recent selection or multiple selections
  // up by one row in screen coordinates.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  moveLineUp(options = {}) {
    if (!this.ensureWritable('moveLineUp', options)) return;

    const selections = this.getSelectedBufferRanges().sort((a, b) =>
      a.compare(b)
    );

    if (selections[0].start.row === 0) return;
    if (
      selections[selections.length - 1].start.row === this.getLastBufferRow() &&
      this.buffer.getLastLine() === ''
    )
      return;

    this.transact(() => {
      const newSelectionRanges = [];

      while (selections.length > 0) {
        // Find selections spanning a contiguous set of lines
        const selection = selections.shift();
        const selectionsToMove = [selection];

        while (
          selection.end.row ===
          (selections[0] != null ? selections[0].start.row : undefined)
        ) {
          selectionsToMove.push(selections[0]);
          selection.end.row = selections[0].end.row;
          selections.shift();
        }

        // Compute the buffer range spanned by all these selections, expanding it
        // so that it includes any folded region that intersects them.
        let startRow = selection.start.row;
        let endRow = selection.end.row;
        if (
          selection.end.row > selection.start.row &&
          selection.end.column === 0
        ) {
          // Don't move the last line of a multi-line selection if the selection ends at column 0
          endRow--;
        }

        startRow = this.displayLayer.findBoundaryPrecedingBufferRow(startRow);
        endRow = this.displayLayer.findBoundaryFollowingBufferRow(endRow + 1);
        const linesRange = new Range(Point(startRow, 0), Point(endRow, 0));

        // If selected line range is preceded by a fold, one line above on screen
        // could be multiple lines in the buffer.
        const precedingRow = this.displayLayer.findBoundaryPrecedingBufferRow(
          startRow - 1
        );
        const insertDelta = linesRange.start.row - precedingRow;

        // Any folds in the text that is moved will need to be re-created.
        // It includes the folds that were intersecting with the selection.
        const rangesToRefold = this.displayLayer
          .destroyFoldsIntersectingBufferRange(linesRange)
          .map(range => range.translate([-insertDelta, 0]));

        // Delete lines spanned by selection and insert them on the preceding buffer row
        let lines = this.buffer.getTextInRange(linesRange);
        if (lines[lines.length - 1] !== '\n') {
          lines += this.buffer.lineEndingForRow(linesRange.end.row - 2);
        }
        this.buffer.delete(linesRange);
        this.buffer.insert([precedingRow, 0], lines);

        // Restore folds that existed before the lines were moved
        for (let rangeToRefold of rangesToRefold) {
          this.displayLayer.foldBufferRange(rangeToRefold);
        }

        for (const selectionToMove of selectionsToMove) {
          newSelectionRanges.push(selectionToMove.translate([-insertDelta, 0]));
        }
      }

      this.setSelectedBufferRanges(newSelectionRanges, {
        autoscroll: false,
        preserveFolds: true
      });
      if (this.shouldAutoIndent()) this.autoIndentSelectedRows();
      this.scrollToBufferPosition([newSelectionRanges[0].start.row, 0]);
    });
  }

  // Move lines intersecting the most recent selection or multiple selections
  // down by one row in screen coordinates.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  moveLineDown(options = {}) {
    if (!this.ensureWritable('moveLineDown', options)) return;

    const selections = this.getSelectedBufferRanges();
    selections.sort((a, b) => b.compare(a));

    this.transact(() => {
      this.consolidateSelections();
      const newSelectionRanges = [];

      while (selections.length > 0) {
        // Find selections spanning a contiguous set of lines
        const selection = selections.shift();
        const selectionsToMove = [selection];

        // if the current selection start row matches the next selections' end row - make them one selection
        while (
          selection.start.row ===
          (selections[0] != null ? selections[0].end.row : undefined)
        ) {
          selectionsToMove.push(selections[0]);
          selection.start.row = selections[0].start.row;
          selections.shift();
        }

        // Compute the buffer range spanned by all these selections, expanding it
        // so that it includes any folded region that intersects them.
        let startRow = selection.start.row;
        let endRow = selection.end.row;
        if (
          selection.end.row > selection.start.row &&
          selection.end.column === 0
        ) {
          // Don't move the last line of a multi-line selection if the selection ends at column 0
          endRow--;
        }

        startRow = this.displayLayer.findBoundaryPrecedingBufferRow(startRow);
        endRow = this.displayLayer.findBoundaryFollowingBufferRow(endRow + 1);
        const linesRange = new Range(Point(startRow, 0), Point(endRow, 0));

        // If selected line range is followed by a fold, one line below on screen
        // could be multiple lines in the buffer. But at the same time, if the
        // next buffer row is wrapped, one line in the buffer can represent many
        // screen rows.
        const followingRow = Math.min(
          this.buffer.getLineCount(),
          this.displayLayer.findBoundaryFollowingBufferRow(endRow + 1)
        );
        const insertDelta = followingRow - linesRange.end.row;

        // Any folds in the text that is moved will need to be re-created.
        // It includes the folds that were intersecting with the selection.
        const rangesToRefold = this.displayLayer
          .destroyFoldsIntersectingBufferRange(linesRange)
          .map(range => range.translate([insertDelta, 0]));

        // Delete lines spanned by selection and insert them on the following correct buffer row
        let lines = this.buffer.getTextInRange(linesRange);
        if (followingRow - 1 === this.buffer.getLastRow()) {
          lines = `\n${lines}`;
        }

        this.buffer.insert([followingRow, 0], lines);
        this.buffer.delete(linesRange);

        // Restore folds that existed before the lines were moved
        for (let rangeToRefold of rangesToRefold) {
          this.displayLayer.foldBufferRange(rangeToRefold);
        }

        for (const selectionToMove of selectionsToMove) {
          newSelectionRanges.push(selectionToMove.translate([insertDelta, 0]));
        }
      }

      this.setSelectedBufferRanges(newSelectionRanges, {
        autoscroll: false,
        preserveFolds: true
      });
      if (this.shouldAutoIndent()) this.autoIndentSelectedRows();
      this.scrollToBufferPosition([newSelectionRanges[0].start.row - 1, 0]);
    });
  }

  // Move any active selections one column to the left.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  moveSelectionLeft(options = {}) {
    if (!this.ensureWritable('moveSelectionLeft', options)) return;
    const selections = this.getSelectedBufferRanges();
    const noSelectionAtStartOfLine = selections.every(
      selection => selection.start.column !== 0
    );

    const translationDelta = [0, -1];
    const translatedRanges = [];

    if (noSelectionAtStartOfLine) {
      this.transact(() => {
        for (let selection of selections) {
          const charToLeftOfSelection = new Range(
            selection.start.translate(translationDelta),
            selection.start
          );
          const charTextToLeftOfSelection = this.buffer.getTextInRange(
            charToLeftOfSelection
          );

          this.buffer.insert(selection.end, charTextToLeftOfSelection);
          this.buffer.delete(charToLeftOfSelection);
          translatedRanges.push(selection.translate(translationDelta));
        }

        this.setSelectedBufferRanges(translatedRanges);
      });
    }
  }

  // Move any active selections one column to the right.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  moveSelectionRight(options = {}) {
    if (!this.ensureWritable('moveSelectionRight', options)) return;
    const selections = this.getSelectedBufferRanges();
    const noSelectionAtEndOfLine = selections.every(selection => {
      return (
        selection.end.column !== this.buffer.lineLengthForRow(selection.end.row)
      );
    });

    const translationDelta = [0, 1];
    const translatedRanges = [];

    if (noSelectionAtEndOfLine) {
      this.transact(() => {
        for (let selection of selections) {
          const charToRightOfSelection = new Range(
            selection.end,
            selection.end.translate(translationDelta)
          );
          const charTextToRightOfSelection = this.buffer.getTextInRange(
            charToRightOfSelection
          );

          this.buffer.delete(charToRightOfSelection);
          this.buffer.insert(selection.start, charTextToRightOfSelection);
          translatedRanges.push(selection.translate(translationDelta));
        }

        this.setSelectedBufferRanges(translatedRanges);
      });
    }
  }

  // Duplicate all lines containing active selections.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  duplicateLines(options = {}) {
    if (!this.ensureWritable('duplicateLines', options)) return;
    this.transact(() => {
      const selections = this.getSelectionsOrderedByBufferPosition();
      const previousSelectionRanges = [];

      let i = selections.length - 1;
      while (i >= 0) {
        const j = i;
        previousSelectionRanges[i] = selections[i].getBufferRange();
        if (selections[i].isEmpty()) {
          const { start } = selections[i].getScreenRange();
          selections[i].setScreenRange([[start.row, 0], [start.row + 1, 0]], {
            preserveFolds: true
          });
        }
        let [startRow, endRow] = selections[i].getBufferRowRange();
        endRow++;
        while (i > 0) {
          const [
            previousSelectionStartRow,
            previousSelectionEndRow
          ] = selections[i - 1].getBufferRowRange();
          if (previousSelectionEndRow === startRow) {
            startRow = previousSelectionStartRow;
            previousSelectionRanges[i - 1] = selections[i - 1].getBufferRange();
            i--;
          } else {
            break;
          }
        }

        const intersectingFolds = this.displayLayer.foldsIntersectingBufferRange(
          [[startRow, 0], [endRow, 0]]
        );
        let textToDuplicate = this.getTextInBufferRange([
          [startRow, 0],
          [endRow, 0]
        ]);
        if (endRow > this.getLastBufferRow())
          textToDuplicate = `\n${textToDuplicate}`;
        this.buffer.insert([endRow, 0], textToDuplicate);

        const insertedRowCount = endRow - startRow;

        for (let k = i; k <= j; k++) {
          selections[k].setBufferRange(
            previousSelectionRanges[k].translate([insertedRowCount, 0])
          );
        }

        for (const fold of intersectingFolds) {
          const foldRange = this.displayLayer.bufferRangeForFold(fold);
          this.displayLayer.foldBufferRange(
            foldRange.translate([insertedRowCount, 0])
          );
        }

        i--;
      }
    });
  }

  replaceSelectedText(options, fn) {
    this.mutateSelectedText(selection => {
      selection.getBufferRange();
      if (options && options.selectWordIfEmpty && selection.isEmpty()) {
        selection.selectWord();
      }
      const text = selection.getText();
      selection.deleteSelectedText();
      const range = selection.insertText(fn(text));
      selection.setBufferRange(range);
    });
  }

  // Split multi-line selections into one selection per line.
  //
  // Operates on all selections. This method breaks apart all multi-line
  // selections to create multiple single-line selections that cumulatively cover
  // the same original area.
  splitSelectionsIntoLines() {
    this.mergeIntersectingSelections(() => {
      for (const selection of this.getSelections()) {
        const range = selection.getBufferRange();
        if (range.isSingleLine()) continue;

        const { start, end } = range;
        this.addSelectionForBufferRange([start, [start.row, Infinity]]);
        let { row } = start;
        while (++row < end.row) {
          this.addSelectionForBufferRange([[row, 0], [row, Infinity]]);
        }
        if (end.column !== 0)
          this.addSelectionForBufferRange([
            [end.row, 0],
            [end.row, end.column]
          ]);
        selection.destroy();
      }
    });
  }

  // Extended: For each selection, transpose the selected text.
  //
  // If the selection is empty, the characters preceding and following the cursor
  // are swapped. Otherwise, the selected characters are reversed.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  transpose(options = {}) {
    if (!this.ensureWritable('transpose', options)) return;
    this.mutateSelectedText(selection => {
      if (selection.isEmpty()) {
        selection.selectRight();
        const text = selection.getText();
        selection.delete();
        selection.cursor.moveLeft();
        selection.insertText(text);
      } else {
        selection.insertText(
          selection
            .getText()
            .split('')
            .reverse()
            .join('')
        );
      }
    });
  }

  // Extended: Convert the selected text to upper case.
  //
  // For each selection, if the selection is empty, converts the containing word
  // to upper case. Otherwise convert the selected text to upper case.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  upperCase(options = {}) {
    if (!this.ensureWritable('upperCase', options)) return;
    this.replaceSelectedText({ selectWordIfEmpty: true }, text =>
      text.toUpperCase(options)
    );
  }

  // Extended: Convert the selected text to lower case.
  //
  // For each selection, if the selection is empty, converts the containing word
  // to upper case. Otherwise convert the selected text to upper case.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  lowerCase(options = {}) {
    if (!this.ensureWritable('lowerCase', options)) return;
    this.replaceSelectedText({ selectWordIfEmpty: true }, text =>
      text.toLowerCase(options)
    );
  }

  // Extended: Toggle line comments for rows intersecting selections.
  //
  // If the current grammar doesn't support comments, does nothing.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  toggleLineCommentsInSelection(options = {}) {
    if (!this.ensureWritable('toggleLineCommentsInSelection', options)) return;
    this.mutateSelectedText(selection => selection.toggleLineComments(options));
  }

  // Convert multiple lines to a single line.
  //
  // Operates on all selections. If the selection is empty, joins the current
  // line with the next line. Otherwise it joins all lines that intersect the
  // selection.
  //
  // Joining a line means that multiple lines are converted to a single line with
  // the contents of each of the original non-empty lines separated by a space.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  joinLines(options = {}) {
    if (!this.ensureWritable('joinLines', options)) return;
    this.mutateSelectedText(selection => selection.joinLines());
  }

  // Extended: For each cursor, insert a newline at beginning the following line.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  insertNewlineBelow(options = {}) {
    if (!this.ensureWritable('insertNewlineBelow', options)) return;
    this.transact(() => {
      this.moveToEndOfLine();
      this.insertNewline(options);
    });
  }

  // Extended: For each cursor, insert a newline at the end of the preceding line.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  insertNewlineAbove(options = {}) {
    if (!this.ensureWritable('insertNewlineAbove', options)) return;
    this.transact(() => {
      const bufferRow = this.getCursorBufferPosition().row;
      const indentLevel = this.indentationForBufferRow(bufferRow);
      const onFirstLine = bufferRow === 0;

      this.moveToBeginningOfLine();
      this.moveLeft();
      this.insertNewline(options);

      if (
        this.shouldAutoIndent() &&
        this.indentationForBufferRow(bufferRow) < indentLevel
      ) {
        this.setIndentationForBufferRow(bufferRow, indentLevel);
      }

      if (onFirstLine) {
        this.moveUp();
        this.moveToEndOfLine();
      }
    });
  }

  // Extended: For each selection, if the selection is empty, delete all characters
  // of the containing word that precede the cursor. Otherwise delete the
  // selected text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToBeginningOfWord(options = {}) {
    if (!this.ensureWritable('deleteToBeginningOfWord', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToBeginningOfWord(options)
    );
  }

  // Extended: Similar to {::deleteToBeginningOfWord}, but deletes only back to the
  // previous word boundary.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToPreviousWordBoundary(options = {}) {
    if (!this.ensureWritable('deleteToPreviousWordBoundary', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToPreviousWordBoundary(options)
    );
  }

  // Extended: Similar to {::deleteToEndOfWord}, but deletes only up to the
  // next word boundary.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToNextWordBoundary(options = {}) {
    if (!this.ensureWritable('deleteToNextWordBoundary', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToNextWordBoundary(options)
    );
  }

  // Extended: For each selection, if the selection is empty, delete all characters
  // of the containing subword following the cursor. Otherwise delete the selected
  // text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToBeginningOfSubword(options = {}) {
    if (!this.ensureWritable('deleteToBeginningOfSubword', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToBeginningOfSubword(options)
    );
  }

  // Extended: For each selection, if the selection is empty, delete all characters
  // of the containing subword following the cursor. Otherwise delete the selected
  // text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToEndOfSubword(options = {}) {
    if (!this.ensureWritable('deleteToEndOfSubword', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToEndOfSubword(options)
    );
  }

  // Extended: For each selection, if the selection is empty, delete all characters
  // of the containing line that precede the cursor. Otherwise delete the
  // selected text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToBeginningOfLine(options = {}) {
    if (!this.ensureWritable('deleteToBeginningOfLine', options)) return;
    this.mutateSelectedText(selection =>
      selection.deleteToBeginningOfLine(options)
    );
  }

  // Extended: For each selection, if the selection is not empty, deletes the
  // selection; otherwise, deletes all characters of the containing line
  // following the cursor. If the cursor is already at the end of the line,
  // deletes the following newline.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToEndOfLine(options = {}) {
    if (!this.ensureWritable('deleteToEndOfLine', options)) return;
    this.mutateSelectedText(selection => selection.deleteToEndOfLine(options));
  }

  // Extended: For each selection, if the selection is empty, delete all characters
  // of the containing word following the cursor. Otherwise delete the selected
  // text.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteToEndOfWord(options = {}) {
    if (!this.ensureWritable('deleteToEndOfWord', options)) return;
    this.mutateSelectedText(selection => selection.deleteToEndOfWord(options));
  }

  // Extended: Delete all lines intersecting selections.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor. (default: false)
  deleteLine(options = {}) {
    if (!this.ensureWritable('deleteLine', options)) return;
    this.mergeSelectionsOnSameRows();
    this.mutateSelectedText(selection => selection.deleteLine(options));
  }

  // Private: Ensure that this editor is not marked read-only before allowing a buffer modification to occur. If
  // the editor is read-only, require an explicit opt-in option to proceed (`bypassReadOnly`) or throw an Error.
  ensureWritable() {
    return true;
  }

  /*
  Section: Decorations
  */

  // Essential: Add a decoration that tracks a {DisplayMarker}. When the
  // marker moves, is invalidated, or is destroyed, the decoration will be
  // updated to reflect the marker's state.
  //
  // The following are the supported decorations types:
  //
  // * __line__: Adds the given CSS `class` to the lines overlapping the rows
  //     spanned by the marker.
  // * __line-number__: Adds the given CSS `class` to the line numbers overlapping
  //     the rows spanned by the marker
  // * __text__: Injects spans into all text overlapping the marked range, then adds
  //     the given `class` or `style` to these spans. Use this to manipulate the foreground
  //     color or styling of text in a range.
  // * __highlight__: Creates an absolutely-positioned `.highlight` div to the editor
  //     containing nested divs that cover the marked region. For example, when the user
  //     selects text, the selection is implemented with a highlight decoration. The structure
  //     of this highlight will be:
  //     ```html
  //     <div class="highlight <your-class>">
  //       <!-- Will be one region for each row in the range. Spans 2 lines? There will be 2 regions. -->
  //       <div class="region"></div>
  //     </div>
  //     ```
  // * __overlay__: Positions the view associated with the given item at the head
  //     or tail of the given `DisplayMarker`, depending on the `position` property.
  // * __gutter__: Tracks a {DisplayMarker} in a {Gutter}. Gutter decorations are created
  //     by calling {Gutter::decorateMarker} on the desired `Gutter` instance.
  // * __block__: Positions the view associated with the given item before or
  //     after the row of the given {DisplayMarker}, depending on the `position` property.
  //     Block decorations at the same screen row are ordered by their `order` property.
  // * __cursor__: Render a cursor at the head of the {DisplayMarker}. If multiple cursor decorations
  //     are created for the same marker, their class strings and style objects are combined
  //     into a single cursor. This decoration type may be used to style existing cursors
  //     by passing in their markers or to render artificial cursors that don't actaully
  //     exist in the model by passing a marker that isn't associated with a real cursor.
  //
  // ## Arguments
  //
  // * `marker` A {DisplayMarker} you want this decoration to follow.
  // * `decorationParams` An {Object} representing the decoration e.g.
  //   `{type: 'line-number', class: 'linter-error'}`
  //   * `type` Determines the behavior and appearance of this {Decoration}. Supported decoration types
  //     and their uses are listed above.
  //   * `class` This CSS class will be applied to the decorated line number,
  //     line, text spans, highlight regions, cursors, or overlay.
  //   * `style` An {Object} containing CSS style properties to apply to the
  //     relevant DOM node. Currently this only works with a `type` of `cursor`
  //     or `text`.
  //   * `item` (optional) An {HTMLElement} or a model {Object} with a
  //     corresponding view registered. Only applicable to the `gutter`,
  //     `overlay` and `block` decoration types.
  //   * `onlyHead` (optional) If `true`, the decoration will only be applied to
  //     the head of the `DisplayMarker`. Only applicable to the `line` and
  //     `line-number` decoration types.
  //   * `onlyEmpty` (optional) If `true`, the decoration will only be applied if
  //     the associated `DisplayMarker` is empty. Only applicable to the `gutter`,
  //     `line`, and `line-number` decoration types.
  //   * `onlyNonEmpty` (optional) If `true`, the decoration will only be applied
  //     if the associated `DisplayMarker` is non-empty. Only applicable to the
  //     `gutter`, `line`, and `line-number` decoration types.
  //   * `omitEmptyLastRow` (optional) If `false`, the decoration will be applied
  //     to the last row of a non-empty range, even if it ends at column 0.
  //     Defaults to `true`. Only applicable to the `gutter`, `line`, and
  //     `line-number` decoration types.
  //   * `position` (optional) Only applicable to decorations of type `overlay` and `block`.
  //     Controls where the view is positioned relative to the `TextEditorMarker`.
  //     Values can be `'head'` (the default) or `'tail'` for overlay decorations, and
  //     `'before'` (the default) or `'after'` for block decorations.
  //   * `order` (optional) Only applicable to decorations of type `block`. Controls
  //      where the view is positioned relative to other block decorations at the
  //      same screen row. If unspecified, block decorations render oldest to newest.
  //   * `avoidOverflow` (optional) Only applicable to decorations of type
  //      `overlay`. Determines whether the decoration adjusts its horizontal or
  //      vertical position to remain fully visible when it would otherwise
  //      overflow the editor. Defaults to `true`.
  //
  // Returns the created {Decoration} object.
  decorateMarker(marker, decorationParams) {
    return this.decorationManager.decorateMarker(marker, decorationParams);
  }

  // Essential: Add a decoration to every marker in the given marker layer. Can
  // be used to decorate a large number of markers without having to create and
  // manage many individual decorations.
  //
  // * `markerLayer` A {DisplayMarkerLayer} or {MarkerLayer} to decorate.
  // * `decorationParams` The same parameters that are passed to
  //   {TextEditor::decorateMarker}, except the `type` cannot be `overlay` or `gutter`.
  //
  // Returns a {LayerDecoration}.
  decorateMarkerLayer(markerLayer, decorationParams) {
    return this.decorationManager.decorateMarkerLayer(
      markerLayer,
      decorationParams
    );
  }

  // Deprecated: Get all the decorations within a screen row range on the default
  // layer.
  //
  // * `startScreenRow` the {Number} beginning screen row
  // * `endScreenRow` the {Number} end screen row (inclusive)
  //
  // Returns an {Object} of decorations in the form
  //  `{1: [{id: 10, type: 'line-number', class: 'someclass'}], 2: ...}`
  //   where the keys are {DisplayMarker} IDs, and the values are an array of decoration
  //   params objects attached to the marker.
  // Returns an empty object when no decorations are found
  decorationsForScreenRowRange(startScreenRow, endScreenRow) {
    return this.decorationManager.decorationsForScreenRowRange(
      startScreenRow,
      endScreenRow
    );
  }

  decorationsStateForScreenRowRange(startScreenRow, endScreenRow) {
    return this.decorationManager.decorationsStateForScreenRowRange(
      startScreenRow,
      endScreenRow
    );
  }

  // Extended: Get all decorations.
  //
  // * `propertyFilter` (optional) An {Object} containing key value pairs that
  //   the returned decorations' properties must match.
  //
  // Returns an {Array} of {Decoration}s.
  getDecorations(propertyFilter) {
    return this.decorationManager.getDecorations(propertyFilter);
  }

  // Extended: Get all decorations of type 'line'.
  //
  // * `propertyFilter` (optional) An {Object} containing key value pairs that
  //   the returned decorations' properties must match.
  //
  // Returns an {Array} of {Decoration}s.
  getLineDecorations(propertyFilter) {
    return this.decorationManager.getLineDecorations(propertyFilter);
  }

  // Extended: Get all decorations of type 'line-number'.
  //
  // * `propertyFilter` (optional) An {Object} containing key value pairs that
  //   the returned decorations' properties must match.
  //
  // Returns an {Array} of {Decoration}s.
  getLineNumberDecorations(propertyFilter) {
    return this.decorationManager.getLineNumberDecorations(propertyFilter);
  }

  // Extended: Get all decorations of type 'highlight'.
  //
  // * `propertyFilter` (optional) An {Object} containing key value pairs that
  //   the returned decorations' properties must match.
  //
  // Returns an {Array} of {Decoration}s.
  getHighlightDecorations(propertyFilter) {
    return this.decorationManager.getHighlightDecorations(propertyFilter);
  }

  // Extended: Get all decorations of type 'overlay'.
  //
  // * `propertyFilter` (optional) An {Object} containing key value pairs that
  //   the returned decorations' properties must match.
  //
  // Returns an {Array} of {Decoration}s.
  getOverlayDecorations(propertyFilter) {
    return this.decorationManager.getOverlayDecorations(propertyFilter);
  }

  /*
  Section: Markers
  */

  // Essential: Create a marker on the default marker layer with the given range
  // in buffer coordinates. This marker will maintain its logical location as the
  // buffer is changed, so if you mark a particular word, the marker will remain
  // over that word even if the word's location in the buffer changes.
  //
  // * `range` A {Range} or range-compatible {Array}
  // * `properties` A hash of key-value pairs to associate with the marker. There
  //   are also reserved property names that have marker-specific meaning.
  //   * `maintainHistory` (optional) {Boolean} Whether to store this marker's
  //     range before and after each change in the undo history. This allows the
  //     marker's position to be restored more accurately for certain undo/redo
  //     operations, but uses more time and memory. (default: false)
  //   * `reversed` (optional) {Boolean} Creates the marker in a reversed
  //     orientation. (default: false)
  //   * `invalidate` (optional) {String} Determines the rules by which changes
  //     to the buffer *invalidate* the marker. (default: 'overlap') It can be
  //     any of the following strategies, in order of fragility:
  //     * __never__: The marker is never marked as invalid. This is a good choice for
  //       markers representing selections in an editor.
  //     * __surround__: The marker is invalidated by changes that completely surround it.
  //     * __overlap__: The marker is invalidated by changes that surround the
  //       start or end of the marker. This is the default.
  //     * __inside__: The marker is invalidated by changes that extend into the
  //       inside of the marker. Changes that end at the marker's start or
  //       start at the marker's end do not invalidate the marker.
  //     * __touch__: The marker is invalidated by a change that touches the marked
  //       region in any way, including changes that end at the marker's
  //       start or start at the marker's end. This is the most fragile strategy.
  //
  // Returns a {DisplayMarker}.
  markBufferRange(bufferRange, options) {
    return this.defaultMarkerLayer.markBufferRange(bufferRange, options);
  }

  // Essential: Create a marker on the default marker layer with the given range
  // in screen coordinates. This marker will maintain its logical location as the
  // buffer is changed, so if you mark a particular word, the marker will remain
  // over that word even if the word's location in the buffer changes.
  //
  // * `range` A {Range} or range-compatible {Array}
  // * `properties` A hash of key-value pairs to associate with the marker. There
  //   are also reserved property names that have marker-specific meaning.
  //   * `maintainHistory` (optional) {Boolean} Whether to store this marker's
  //     range before and after each change in the undo history. This allows the
  //     marker's position to be restored more accurately for certain undo/redo
  //     operations, but uses more time and memory. (default: false)
  //   * `reversed` (optional) {Boolean} Creates the marker in a reversed
  //     orientation. (default: false)
  //   * `invalidate` (optional) {String} Determines the rules by which changes
  //     to the buffer *invalidate* the marker. (default: 'overlap') It can be
  //     any of the following strategies, in order of fragility:
  //     * __never__: The marker is never marked as invalid. This is a good choice for
  //       markers representing selections in an editor.
  //     * __surround__: The marker is invalidated by changes that completely surround it.
  //     * __overlap__: The marker is invalidated by changes that surround the
  //       start or end of the marker. This is the default.
  //     * __inside__: The marker is invalidated by changes that extend into the
  //       inside of the marker. Changes that end at the marker's start or
  //       start at the marker's end do not invalidate the marker.
  //     * __touch__: The marker is invalidated by a change that touches the marked
  //       region in any way, including changes that end at the marker's
  //       start or start at the marker's end. This is the most fragile strategy.
  //
  // Returns a {DisplayMarker}.
  markScreenRange(screenRange, options) {
    return this.defaultMarkerLayer.markScreenRange(screenRange, options);
  }

  // Essential: Create a marker on the default marker layer with the given buffer
  // position and no tail. To group multiple markers together in their own
  // private layer, see {::addMarkerLayer}.
  //
  // * `bufferPosition` A {Point} or point-compatible {Array}
  // * `options` (optional) An {Object} with the following keys:
  //   * `invalidate` (optional) {String} Determines the rules by which changes
  //     to the buffer *invalidate* the marker. (default: 'overlap') It can be
  //     any of the following strategies, in order of fragility:
  //     * __never__: The marker is never marked as invalid. This is a good choice for
  //       markers representing selections in an editor.
  //     * __surround__: The marker is invalidated by changes that completely surround it.
  //     * __overlap__: The marker is invalidated by changes that surround the
  //       start or end of the marker. This is the default.
  //     * __inside__: The marker is invalidated by changes that extend into the
  //       inside of the marker. Changes that end at the marker's start or
  //       start at the marker's end do not invalidate the marker.
  //     * __touch__: The marker is invalidated by a change that touches the marked
  //       region in any way, including changes that end at the marker's
  //       start or start at the marker's end. This is the most fragile strategy.
  //
  // Returns a {DisplayMarker}.
  markBufferPosition(bufferPosition, options) {
    return this.defaultMarkerLayer.markBufferPosition(bufferPosition, options);
  }

  // Essential: Create a marker on the default marker layer with the given screen
  // position and no tail. To group multiple markers together in their own
  // private layer, see {::addMarkerLayer}.
  //
  // * `screenPosition` A {Point} or point-compatible {Array}
  // * `options` (optional) An {Object} with the following keys:
  //   * `invalidate` (optional) {String} Determines the rules by which changes
  //     to the buffer *invalidate* the marker. (default: 'overlap') It can be
  //     any of the following strategies, in order of fragility:
  //     * __never__: The marker is never marked as invalid. This is a good choice for
  //       markers representing selections in an editor.
  //     * __surround__: The marker is invalidated by changes that completely surround it.
  //     * __overlap__: The marker is invalidated by changes that surround the
  //       start or end of the marker. This is the default.
  //     * __inside__: The marker is invalidated by changes that extend into the
  //       inside of the marker. Changes that end at the marker's start or
  //       start at the marker's end do not invalidate the marker.
  //     * __touch__: The marker is invalidated by a change that touches the marked
  //       region in any way, including changes that end at the marker's
  //       start or start at the marker's end. This is the most fragile strategy.
  //   * `clipDirection` {String} If `'backward'`, returns the first valid
  //     position preceding an invalid position. If `'forward'`, returns the
  //     first valid position following an invalid position. If `'closest'`,
  //     returns the first valid position closest to an invalid position.
  //     Defaults to `'closest'`.
  //
  // Returns a {DisplayMarker}.
  markScreenPosition(screenPosition, options) {
    return this.defaultMarkerLayer.markScreenPosition(screenPosition, options);
  }

  // Essential: Find all {DisplayMarker}s on the default marker layer that
  // match the given properties.
  //
  // This method finds markers based on the given properties. Markers can be
  // associated with custom properties that will be compared with basic equality.
  // In addition, there are several special properties that will be compared
  // with the range of the markers rather than their properties.
  //
  // * `properties` An {Object} containing properties that each returned marker
  //   must satisfy. Markers can be associated with custom properties, which are
  //   compared with basic equality. In addition, several reserved properties
  //   can be used to filter markers based on their current range:
  //   * `startBufferRow` Only include markers starting at this row in buffer
  //       coordinates.
  //   * `endBufferRow` Only include markers ending at this row in buffer
  //       coordinates.
  //   * `containsBufferRange` Only include markers containing this {Range} or
  //       in range-compatible {Array} in buffer coordinates.
  //   * `containsBufferPosition` Only include markers containing this {Point}
  //       or {Array} of `[row, column]` in buffer coordinates.
  //
  // Returns an {Array} of {DisplayMarker}s
  findMarkers(params) {
    return this.defaultMarkerLayer.findMarkers(params);
  }

  // Extended: Get the {DisplayMarker} on the default layer for the given
  // marker id.
  //
  // * `id` {Number} id of the marker
  getMarker(id) {
    return this.defaultMarkerLayer.getMarker(id);
  }

  // Extended: Get all {DisplayMarker}s on the default marker layer. Consider
  // using {::findMarkers}
  getMarkers() {
    return this.defaultMarkerLayer.getMarkers();
  }

  // Extended: Get the number of markers in the default marker layer.
  //
  // Returns a {Number}.
  getMarkerCount() {
    return this.defaultMarkerLayer.getMarkerCount();
  }

  destroyMarker(id) {
    const marker = this.getMarker(id);
    if (marker) marker.destroy();
  }

  // Essential: Create a marker layer to group related markers.
  //
  // * `options` An {Object} containing the following keys:
  //   * `maintainHistory` A {Boolean} indicating whether marker state should be
  //     restored on undo/redo. Defaults to `false`.
  //   * `persistent` A {Boolean} indicating whether or not this marker layer
  //     should be serialized and deserialized along with the rest of the
  //     buffer. Defaults to `false`. If `true`, the marker layer's id will be
  //     maintained across the serialization boundary, allowing you to retrieve
  //     it via {::getMarkerLayer}.
  //
  // Returns a {DisplayMarkerLayer}.
  addMarkerLayer(options) {
    return this.displayLayer.addMarkerLayer(options);
  }

  // Essential: Get a {DisplayMarkerLayer} by id.
  //
  // * `id` The id of the marker layer to retrieve.
  //
  // Returns a {DisplayMarkerLayer} or `undefined` if no layer exists with the
  // given id.
  getMarkerLayer(id) {
    return this.displayLayer.getMarkerLayer(id);
  }

  // Essential: Get the default {DisplayMarkerLayer}.
  //
  // All marker APIs not tied to an explicit layer interact with this default
  // layer.
  //
  // Returns a {DisplayMarkerLayer}.
  getDefaultMarkerLayer() {
    return this.defaultMarkerLayer;
  }

  /*
  Section: Selections
  */

  // Essential: Get the selected text of the most recently added selection.
  //
  // Returns a {String}.
  getSelectedText() {
    return this.getLastSelection().getText();
  }

  // Essential: Get the {Range} of the most recently added selection in buffer
  // coordinates.
  //
  // Returns a {Range}.
  getSelectedBufferRange() {
    return this.getLastSelection().getBufferRange();
  }

  // Essential: Get the {Range}s of all selections in buffer coordinates.
  //
  // The ranges are sorted by when the selections were added. Most recent at the end.
  //
  // Returns an {Array} of {Range}s.
  getSelectedBufferRanges() {
    return this.getSelections().map(selection => selection.getBufferRange());
  }

  // Essential: Set the selected range in buffer coordinates. If there are multiple
  // selections, they are reduced to a single selection with the given range.
  //
  // * `bufferRange` A {Range} or range-compatible {Array}.
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  //   * `preserveFolds` A {Boolean}, which if `true` preserves the fold settings after the
  //     selection is set.
  setSelectedBufferRange(bufferRange, options) {
    return this.setSelectedBufferRanges([bufferRange], options);
  }

  // Essential: Set the selected ranges in buffer coordinates. If there are multiple
  // selections, they are replaced by new selections with the given ranges.
  //
  // * `bufferRanges` An {Array} of {Range}s or range-compatible {Array}s.
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  //   * `preserveFolds` A {Boolean}, which if `true` preserves the fold settings after the
  //     selection is set.
  setSelectedBufferRanges(bufferRanges, options = {}) {
    if (!bufferRanges.length)
      throw new Error('Passed an empty array to setSelectedBufferRanges');

    const selections = this.getSelections();
    for (let selection of selections.slice(bufferRanges.length)) {
      selection.destroy();
    }

    this.mergeIntersectingSelections(options, () => {
      for (let i = 0; i < bufferRanges.length; i++) {
        let bufferRange = bufferRanges[i];
        bufferRange = Range.fromObject(bufferRange);
        if (selections[i]) {
          selections[i].setBufferRange(bufferRange, options);
        } else {
          this.addSelectionForBufferRange(bufferRange, options);
        }
      }
    });
  }

  // Essential: Get the {Range} of the most recently added selection in screen
  // coordinates.
  //
  // Returns a {Range}.
  getSelectedScreenRange() {
    return this.getLastSelection().getScreenRange();
  }

  // Essential: Get the {Range}s of all selections in screen coordinates.
  //
  // The ranges are sorted by when the selections were added. Most recent at the end.
  //
  // Returns an {Array} of {Range}s.
  getSelectedScreenRanges() {
    return this.getSelections().map(selection => selection.getScreenRange());
  }

  // Essential: Set the selected range in screen coordinates. If there are multiple
  // selections, they are reduced to a single selection with the given range.
  //
  // * `screenRange` A {Range} or range-compatible {Array}.
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  setSelectedScreenRange(screenRange, options) {
    return this.setSelectedBufferRange(
      this.bufferRangeForScreenRange(screenRange, options),
      options
    );
  }

  // Essential: Set the selected ranges in screen coordinates. If there are multiple
  // selections, they are replaced by new selections with the given ranges.
  //
  // * `screenRanges` An {Array} of {Range}s or range-compatible {Array}s.
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  setSelectedScreenRanges(screenRanges, options = {}) {
    if (!screenRanges.length)
      throw new Error('Passed an empty array to setSelectedScreenRanges');

    const selections = this.getSelections();
    for (let selection of selections.slice(screenRanges.length)) {
      selection.destroy();
    }

    this.mergeIntersectingSelections(options, () => {
      for (let i = 0; i < screenRanges.length; i++) {
        let screenRange = screenRanges[i];
        screenRange = Range.fromObject(screenRange);
        if (selections[i]) {
          selections[i].setScreenRange(screenRange, options);
        } else {
          this.addSelectionForScreenRange(screenRange, options);
        }
      }
    });
  }

  // Essential: Add a selection for the given range in buffer coordinates.
  //
  // * `bufferRange` A {Range}
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  //   * `preserveFolds` A {Boolean}, which if `true` preserves the fold settings after the
  //     selection is set.
  //
  // Returns the added {Selection}.
  addSelectionForBufferRange(bufferRange, options = {}) {
    bufferRange = Range.fromObject(bufferRange);
    // if (!options.preserveFolds) {
    //   this.displayLayer.destroyFoldsContainingBufferPositions(
    //     [bufferRange.start, bufferRange.end],
    //     true
    //   );
    // }
    this.selectionsMarkerLayer.markBufferRange(bufferRange, {
      invalidate: 'never',
      reversed: options.reversed != null ? options.reversed : false
    });
    if (options.autoscroll !== false) this.getLastSelection().autoscroll();
    return this.getLastSelection();
  }

  // Essential: Add a selection for the given range in screen coordinates.
  //
  // * `screenRange` A {Range}
  // * `options` (optional) An options {Object}:
  //   * `reversed` A {Boolean} indicating whether to create the selection in a
  //     reversed orientation.
  //   * `preserveFolds` A {Boolean}, which if `true` preserves the fold settings after the
  //     selection is set.
  // Returns the added {Selection}.
  addSelectionForScreenRange(screenRange, options = {}) {
    return this.addSelectionForBufferRange(
      this.bufferRangeForScreenRange(screenRange),
      options
    );
  }

  // Essential: Select from the current cursor position to the given position in
  // buffer coordinates.
  //
  // This method may merge selections that end up intersecting.
  //
  // * `position` An instance of {Point}, with a given `row` and `column`.
  selectToBufferPosition(position) {
    const lastSelection = this.getLastSelection();
    lastSelection.selectToBufferPosition(position);
    return this.mergeIntersectingSelections({
      reversed: lastSelection.isReversed()
    });
  }

  // Essential: Select from the current cursor position to the given position in
  // screen coordinates.
  //
  // This method may merge selections that end up intersecting.
  //
  // * `position` An instance of {Point}, with a given `row` and `column`.
  selectToScreenPosition(position, options) {
    const lastSelection = this.getLastSelection();
    lastSelection.selectToScreenPosition(position, options);
    if (!options || !options.suppressSelectionMerge) {
      return this.mergeIntersectingSelections({
        reversed: lastSelection.isReversed()
      });
    }
  }

  // Essential: Move the cursor of each selection one character upward while
  // preserving the selection's tail position.
  //
  // * `rowCount` (optional) {Number} number of rows to select (default: 1)
  //
  // This method may merge selections that end up intersecting.
  selectUp(rowCount) {
    return this.expandSelectionsBackward(selection =>
      selection.selectUp(rowCount)
    );
  }

  // Essential: Move the cursor of each selection one character downward while
  // preserving the selection's tail position.
  //
  // * `rowCount` (optional) {Number} number of rows to select (default: 1)
  //
  // This method may merge selections that end up intersecting.
  selectDown(rowCount) {
    return this.expandSelectionsForward(selection =>
      selection.selectDown(rowCount)
    );
  }

  // Essential: Move the cursor of each selection one character leftward while
  // preserving the selection's tail position.
  //
  // * `columnCount` (optional) {Number} number of columns to select (default: 1)
  //
  // This method may merge selections that end up intersecting.
  selectLeft(columnCount) {
    return this.expandSelectionsBackward(selection =>
      selection.selectLeft(columnCount)
    );
  }

  // Essential: Move the cursor of each selection one character rightward while
  // preserving the selection's tail position.
  //
  // * `columnCount` (optional) {Number} number of columns to select (default: 1)
  //
  // This method may merge selections that end up intersecting.
  selectRight(columnCount) {
    return this.expandSelectionsForward(selection =>
      selection.selectRight(columnCount)
    );
  }

  // Essential: Select from the top of the buffer to the end of the last selection
  // in the buffer.
  //
  // This method merges multiple selections into a single selection.
  selectToTop() {
    return this.expandSelectionsBackward(selection => selection.selectToTop());
  }

  // Essential: Selects from the top of the first selection in the buffer to the end
  // of the buffer.
  //
  // This method merges multiple selections into a single selection.
  selectToBottom() {
    return this.expandSelectionsForward(selection =>
      selection.selectToBottom()
    );
  }

  // Essential: Select all text in the buffer.
  //
  // This method merges multiple selections into a single selection.
  selectAll() {
    return this.expandSelectionsForward(selection => selection.selectAll());
  }

  // Essential: Move the cursor of each selection to the beginning of its line
  // while preserving the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToBeginningOfLine() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToBeginningOfLine()
    );
  }

  // Essential: Move the cursor of each selection to the first non-whitespace
  // character of its line while preserving the selection's tail position. If the
  // cursor is already on the first character of the line, move it to the
  // beginning of the line.
  //
  // This method may merge selections that end up intersecting.
  selectToFirstCharacterOfLine() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToFirstCharacterOfLine()
    );
  }

  // Essential: Move the cursor of each selection to the end of its line while
  // preserving the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToEndOfLine() {
    return this.expandSelectionsForward(selection =>
      selection.selectToEndOfLine()
    );
  }

  // Essential: Expand selections to the beginning of their containing word.
  //
  // Operates on all selections. Moves the cursor to the beginning of the
  // containing word while preserving the selection's tail position.
  selectToBeginningOfWord() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToBeginningOfWord()
    );
  }

  // Essential: Expand selections to the end of their containing word.
  //
  // Operates on all selections. Moves the cursor to the end of the containing
  // word while preserving the selection's tail position.
  selectToEndOfWord() {
    return this.expandSelectionsForward(selection =>
      selection.selectToEndOfWord()
    );
  }

  // Extended: For each selection, move its cursor to the preceding subword
  // boundary while maintaining the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToPreviousSubwordBoundary() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToPreviousSubwordBoundary()
    );
  }

  // Extended: For each selection, move its cursor to the next subword boundary
  // while maintaining the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToNextSubwordBoundary() {
    return this.expandSelectionsForward(selection =>
      selection.selectToNextSubwordBoundary()
    );
  }

  // Essential: For each cursor, select the containing line.
  //
  // This method merges selections on successive lines.
  selectLinesContainingCursors() {
    return this.expandSelectionsForward(selection => selection.selectLine());
  }

  // Essential: Select the word surrounding each cursor.
  selectWordsContainingCursors() {
    return this.expandSelectionsForward(selection => selection.selectWord());
  }

  // Selection Extended

  // Extended: For each selection, move its cursor to the preceding word boundary
  // while maintaining the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToPreviousWordBoundary() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToPreviousWordBoundary()
    );
  }

  // Extended: For each selection, move its cursor to the next word boundary while
  // maintaining the selection's tail position.
  //
  // This method may merge selections that end up intersecting.
  selectToNextWordBoundary() {
    return this.expandSelectionsForward(selection =>
      selection.selectToNextWordBoundary()
    );
  }

  // Extended: Expand selections to the beginning of the next word.
  //
  // Operates on all selections. Moves the cursor to the beginning of the next
  // word while preserving the selection's tail position.
  selectToBeginningOfNextWord() {
    return this.expandSelectionsForward(selection =>
      selection.selectToBeginningOfNextWord()
    );
  }

  // Extended: Expand selections to the beginning of the next paragraph.
  //
  // Operates on all selections. Moves the cursor to the beginning of the next
  // paragraph while preserving the selection's tail position.
  selectToBeginningOfNextParagraph() {
    return this.expandSelectionsForward(selection =>
      selection.selectToBeginningOfNextParagraph()
    );
  }

  // Extended: Expand selections to the beginning of the next paragraph.
  //
  // Operates on all selections. Moves the cursor to the beginning of the next
  // paragraph while preserving the selection's tail position.
  selectToBeginningOfPreviousParagraph() {
    return this.expandSelectionsBackward(selection =>
      selection.selectToBeginningOfPreviousParagraph()
    );
  }

  // Extended: For each selection, select the syntax node that contains
  // that selection.
  selectLargerSyntaxNode() {
    const languageMode = this.buffer.getLanguageMode();
    if (!languageMode.getRangeForSyntaxNodeContainingRange) return;

    this.expandSelectionsForward(selection => {
      const currentRange = selection.getBufferRange();
      const newRange = languageMode.getRangeForSyntaxNodeContainingRange(
        currentRange
      );
      if (newRange) {
        if (!selection._rangeStack) selection._rangeStack = [];
        selection._rangeStack.push(currentRange);
        selection.setBufferRange(newRange);
      }
    });
  }

  // Extended: Undo the effect a preceding call to {::selectLargerSyntaxNode}.
  selectSmallerSyntaxNode() {
    this.expandSelectionsForward(selection => {
      if (selection._rangeStack) {
        const lastRange =
          selection._rangeStack[selection._rangeStack.length - 1];
        if (lastRange && selection.getBufferRange().containsRange(lastRange)) {
          selection._rangeStack.length--;
          selection.setBufferRange(lastRange);
        }
      }
    });
  }

  // Extended: Select the range of the given marker if it is valid.
  //
  // * `marker` A {DisplayMarker}
  //
  // Returns the selected {Range} or `undefined` if the marker is invalid.
  selectMarker(marker) {
    if (marker.isValid()) {
      const range = marker.getBufferRange();
      this.setSelectedBufferRange(range);
      return range;
    }
  }

  // Extended: Get the most recently added {Selection}.
  //
  // Returns a {Selection}.
  getLastSelection() {
    this.createLastSelectionIfNeeded();
    return _.last(this.selections);
  }

  getSelectionAtScreenPosition(position) {
    const markers = this.selectionsMarkerLayer.findMarkers({
      containsScreenPosition: position
    });
    if (markers.length > 0)
      return this.cursorsByMarkerId.get(markers[0].id).selection;
  }

  // Extended: Get current {Selection}s.
  //
  // Returns: An {Array} of {Selection}s.
  getSelections() {
    this.createLastSelectionIfNeeded();
    return this.selections.slice();
  }

  // Extended: Get all {Selection}s, ordered by their position in the buffer
  // instead of the order in which they were added.
  //
  // Returns an {Array} of {Selection}s.
  getSelectionsOrderedByBufferPosition() {
    return this.getSelections().sort((a, b) => a.compare(b));
  }

  // Extended: Determine if a given range in buffer coordinates intersects a
  // selection.
  //
  // * `bufferRange` A {Range} or range-compatible {Array}.
  //
  // Returns a {Boolean}.
  selectionIntersectsBufferRange(bufferRange) {
    return this.getSelections().some(selection =>
      selection.intersectsBufferRange(bufferRange)
    );
  }

  // Selections Private

  // Add a similarly-shaped selection to the next eligible line below
  // each selection.
  //
  // Operates on all selections. If the selection is empty, adds an empty
  // selection to the next following non-empty line as close to the current
  // selection's column as possible. If the selection is non-empty, adds a
  // selection to the next line that is long enough for a non-empty selection
  // starting at the same column as the current selection to be added to it.
  addSelectionBelow() {
    return this.expandSelectionsForward(selection =>
      selection.addSelectionBelow()
    );
  }

  // Add a similarly-shaped selection to the next eligible line above
  // each selection.
  //
  // Operates on all selections. If the selection is empty, adds an empty
  // selection to the next preceding non-empty line as close to the current
  // selection's column as possible. If the selection is non-empty, adds a
  // selection to the next line that is long enough for a non-empty selection
  // starting at the same column as the current selection to be added to it.
  addSelectionAbove() {
    return this.expandSelectionsBackward(selection =>
      selection.addSelectionAbove()
    );
  }

  // Calls the given function with each selection, then merges selections
  expandSelectionsForward(fn) {
    this.mergeIntersectingSelections(() => this.getSelections().forEach(fn));
  }

  // Calls the given function with each selection, then merges selections in the
  // reversed orientation
  expandSelectionsBackward(fn) {
    this.mergeIntersectingSelections({ reversed: true }, () =>
      this.getSelections().forEach(fn)
    );
  }

  finalizeSelections() {
    for (let selection of this.getSelections()) {
      selection.finalize();
    }
  }

  selectionsForScreenRows(startRow, endRow) {
    return this.getSelections().filter(selection =>
      selection.intersectsScreenRowRange(startRow, endRow)
    );
  }

  // Merges intersecting selections. If passed a function, it executes
  // the function with merging suppressed, then merges intersecting selections
  // afterward.
  mergeIntersectingSelections(...args) {
    return this.mergeSelections(
      ...args,
      (previousSelection, currentSelection) => {
        const exclusive =
          !currentSelection.isEmpty() && !previousSelection.isEmpty();
        return previousSelection.intersectsWith(currentSelection, exclusive);
      }
    );
  }

  mergeSelectionsOnSameRows(...args) {
    return this.mergeSelections(
      ...args,
      (previousSelection, currentSelection) => {
        const screenRange = currentSelection.getScreenRange();
        return previousSelection.intersectsScreenRowRange(
          screenRange.start.row,
          screenRange.end.row
        );
      }
    );
  }

  avoidMergingSelections(...args) {
    return this.mergeSelections(...args, () => false);
  }

  mergeSelections(...args) {
    const mergePredicate = args.pop();
    let fn = args.pop();
    let options = args.pop();
    if (typeof fn !== 'function') {
      options = fn;
      fn = () => {};
    }

    if (this.suppressSelectionMerging) return fn();

    this.suppressSelectionMerging = true;
    const result = fn();
    this.suppressSelectionMerging = false;

    const selections = this.getSelectionsOrderedByBufferPosition();
    let lastSelection = selections.shift();
    for (const selection of selections) {
      if (mergePredicate(lastSelection, selection)) {
        lastSelection.merge(selection, options);
      } else {
        lastSelection = selection;
      }
    }

    return result;
  }

  // Add a {Selection} based on the given {DisplayMarker}.
  //
  // * `marker` The {DisplayMarker} to highlight
  // * `options` (optional) An {Object} that pertains to the {Selection} constructor.
  //
  // Returns the new {Selection}.
  addSelection(marker, options = {}) {
    const cursor = this.addCursor(marker);
    let selection = new Selection(
      Object.assign({ editor: this, marker, cursor }, options)
    );
    this.selections.push(selection);
    const selectionBufferRange = selection.getBufferRange();
    this.mergeIntersectingSelections({ preserveFolds: options.preserveFolds });

    if (selection.destroyed) {
      for (selection of this.getSelections()) {
        if (selection.intersectsBufferRange(selectionBufferRange))
          return selection;
      }
    } else {
      this.emitter.emit('did-add-cursor', cursor);
      this.emitter.emit('did-add-selection', selection);
      return selection;
    }
  }

  // Remove the given selection.
  removeSelection(selection) {
    _.remove(this.cursors, selection.cursor);
    _.remove(this.selections, selection);
    this.cursorsByMarkerId.delete(selection.cursor.marker.id);
    this.emitter.emit('did-remove-cursor', selection.cursor);
    return this.emitter.emit('did-remove-selection', selection);
  }

  // Reduce one or more selections to a single empty selection based on the most
  // recently added cursor.
  clearSelections(options) {
    this.consolidateSelections();
    this.getLastSelection().clear(options);
  }

  // Reduce multiple selections to the least recently added selection.
  consolidateSelections() {
    const selections = this.getSelections();
    if (selections.length > 1) {
      for (let selection of selections.slice(1, selections.length)) {
        selection.destroy();
      }
      selections[0].autoscroll({ center: true });
      return true;
    } else {
      return false;
    }
  }

  // Called by the selection
  selectionRangeChanged(event) {
    if (this.component) this.component.didChangeSelectionRange();
    this.emitter.emit('did-change-selection-range', event);
  }

  createLastSelectionIfNeeded() {
    if (this.selections.length === 0) {
      this.addSelectionForBufferRange([[0, 0], [0, 0]], {
        autoscroll: false,
        preserveFolds: true
      });
    }
  }

  /*
  Section: Searching and Replacing
  */

  // Essential: Scan regular expression matches in the entire buffer, calling the
  // given iterator function on each match.
  //
  // `::scan` functions as the replace method as well via the `replace`
  //
  // If you're programmatically modifying the results, you may want to try
  // {::backwardsScanInBufferRange} to avoid tripping over your own changes.
  //
  // * `regex` A {RegExp} to search for.
  // * `options` (optional) {Object}
  //   * `leadingContextLineCount` {Number} default `0`; The number of lines
  //      before the matched line to include in the results object.
  //   * `trailingContextLineCount` {Number} default `0`; The number of lines
  //      after the matched line to include in the results object.
  // * `iterator` A {Function} that's called on each match
  //   * `object` {Object}
  //     * `match` The current regular expression match.
  //     * `matchText` A {String} with the text of the match.
  //     * `range` The {Range} of the match.
  //     * `stop` Call this {Function} to terminate the scan.
  //     * `replace` Call this {Function} with a {String} to replace the match.
  scan(regex, options = {}, iterator) {
    if (_.isFunction(options)) {
      iterator = options;
      options = {};
    }

    return this.buffer.scan(regex, options, iterator);
  }

  // Essential: Scan regular expression matches in a given range, calling the given
  // iterator function on each match.
  //
  // * `regex` A {RegExp} to search for.
  // * `range` A {Range} in which to search.
  // * `iterator` A {Function} that's called on each match with an {Object}
  //   containing the following keys:
  //   * `match` The current regular expression match.
  //   * `matchText` A {String} with the text of the match.
  //   * `range` The {Range} of the match.
  //   * `stop` Call this {Function} to terminate the scan.
  //   * `replace` Call this {Function} with a {String} to replace the match.
  scanInBufferRange(regex, range, iterator) {
    return this.buffer.scanInRange(regex, range, iterator);
  }

  // Essential: Scan regular expression matches in a given range in reverse order,
  // calling the given iterator function on each match.
  //
  // * `regex` A {RegExp} to search for.
  // * `range` A {Range} in which to search.
  // * `iterator` A {Function} that's called on each match with an {Object}
  //   containing the following keys:
  //   * `match` The current regular expression match.
  //   * `matchText` A {String} with the text of the match.
  //   * `range` The {Range} of the match.
  //   * `stop` Call this {Function} to terminate the scan.
  //   * `replace` Call this {Function} with a {String} to replace the match.
  backwardsScanInBufferRange(regex, range, iterator) {
    return this.buffer.backwardsScanInRange(regex, range, iterator);
  }

  /*
  Section: Tab Behavior
  */

  // Essential: Returns a {Boolean} indicating whether softTabs are enabled for this
  // editor.
  getSoftTabs() {
    return this.softTabs;
  }

  // Essential: Enable or disable soft tabs for this editor.
  //
  // * `softTabs` A {Boolean}
  setSoftTabs(softTabs) {
    this.softTabs = softTabs;
    this.update({ softTabs: this.softTabs });
  }

  // Returns a {Boolean} indicating whether atomic soft tabs are enabled for this editor.
  hasAtomicSoftTabs() {
    return this.displayLayer.atomicSoftTabs;
  }

  // Essential: Toggle soft tabs for this editor
  toggleSoftTabs() {
    this.setSoftTabs(!this.getSoftTabs());
  }

  // Essential: Get the on-screen length of tab characters.
  //
  // Returns a {Number}.
  getTabLength() {
    return this.displayLayer.tabLength;
  }

  // Essential: Set the on-screen length of tab characters. Setting this to a
  // {Number} This will override the `editor.tabLength` setting.
  //
  // * `tabLength` {Number} length of a single tab. Setting to `null` will
  //   fallback to using the `editor.tabLength` config setting
  setTabLength(tabLength) {
    this.update({ tabLength });
  }

  // Returns an {Object} representing the current invisible character
  // substitutions for this editor, whose keys are names of invisible characters
  // and whose values are 1-character {Strings}s that are displayed in place of
  // those invisible characters
  getInvisibles() {
    if (!this.mini && this.showInvisibles && this.invisibles != null) {
      return this.invisibles;
    } else {
      return {};
    }
  }

  doesShowIndentGuide() {
    return this.showIndentGuide && !this.mini;
  }

  getSoftWrapHangingIndentLength() {
    return this.displayLayer.softWrapHangingIndent;
  }

  // Extended: Determine if the buffer uses hard or soft tabs.
  //
  // Returns `true` if the first non-comment line with leading whitespace starts
  // with a space character. Returns `false` if it starts with a hard tab (`\t`).
  //
  // Returns a {Boolean} or undefined if no non-comment lines had leading
  // whitespace.
  usesSoftTabs() {
    const languageMode = this.buffer.getLanguageMode();
    const hasIsRowCommented = languageMode.isRowCommented;
    for (
      let bufferRow = 0, end = Math.min(1000, this.buffer.getLastRow());
      bufferRow <= end;
      bufferRow++
    ) {
      if (hasIsRowCommented && languageMode.isRowCommented(bufferRow)) continue;
      const line = this.buffer.lineForRow(bufferRow);
      if (line[0] === ' ') return true;
      if (line[0] === '\t') return false;
    }
  }

  // Extended: Get the text representing a single level of indent.
  //
  // If soft tabs are enabled, the text is composed of N spaces, where N is the
  // tab length. Otherwise the text is a tab character (`\t`).
  //
  // Returns a {String}.
  getTabText() {
    return this.buildIndentString(1);
  }

  // If soft tabs are enabled, convert all hard tabs to soft tabs in the given
  // {Range}.
  normalizeTabsInBufferRange(bufferRange) {
    if (!this.getSoftTabs()) {
      return;
    }
    return this.scanInBufferRange(/\t/g, bufferRange, ({ replace }) =>
      replace(this.getTabText())
    );
  }

  /*
  Section: Soft Wrap Behavior
  */

  // Essential: Determine whether lines in this editor are soft-wrapped.
  //
  // Returns a {Boolean}.
  isSoftWrapped() {
    return this.softWrapped;
  }

  // Essential: Enable or disable soft wrapping for this editor.
  //
  // * `softWrapped` A {Boolean}
  //
  // Returns a {Boolean}.
  setSoftWrapped(softWrapped) {
    this.update({ softWrapped });
    return this.isSoftWrapped();
  }

  getPreferredLineLength() {
    return this.preferredLineLength;
  }

  // Essential: Toggle soft wrapping for this editor
  //
  // Returns a {Boolean}.
  toggleSoftWrapped() {
    return this.setSoftWrapped(!this.isSoftWrapped());
  }

  // Essential: Gets the column at which column will soft wrap
  getSoftWrapColumn() {
    if (this.isSoftWrapped() && !this.mini) {
      if (this.softWrapAtPreferredLineLength) {
        return Math.min(this.getEditorWidthInChars(), this.preferredLineLength);
      } else {
        return this.getEditorWidthInChars();
      }
    } else {
      return this.maxScreenLineLength;
    }
  }

  /*
  Section: Indentation
  */

  // Essential: Get the indentation level of the given buffer row.
  //
  // Determines how deeply the given row is indented based on the soft tabs and
  // tab length settings of this editor. Note that if soft tabs are enabled and
  // the tab length is 2, a row with 4 leading spaces would have an indentation
  // level of 2.
  //
  // * `bufferRow` A {Number} indicating the buffer row.
  //
  // Returns a {Number}.
  indentationForBufferRow(bufferRow) {
    return this.indentLevelForLine(this.lineTextForBufferRow(bufferRow));
  }

  // Essential: Set the indentation level for the given buffer row.
  //
  // Inserts or removes hard tabs or spaces based on the soft tabs and tab length
  // settings of this editor in order to bring it to the given indentation level.
  // Note that if soft tabs are enabled and the tab length is 2, a row with 4
  // leading spaces would have an indentation level of 2.
  //
  // * `bufferRow` A {Number} indicating the buffer row.
  // * `newLevel` A {Number} indicating the new indentation level.
  // * `options` (optional) An {Object} with the following keys:
  //   * `preserveLeadingWhitespace` `true` to preserve any whitespace already at
  //      the beginning of the line (default: false).
  setIndentationForBufferRow(
    bufferRow,
    newLevel,
    { preserveLeadingWhitespace } = {}
  ) {
    let endColumn;
    if (preserveLeadingWhitespace) {
      endColumn = 0;
    } else {
      endColumn = this.lineTextForBufferRow(bufferRow).match(/^\s*/)[0].length;
    }
    const newIndentString = this.buildIndentString(newLevel);
    return this.buffer.setTextInRange(
      [[bufferRow, 0], [bufferRow, endColumn]],
      newIndentString
    );
  }

  // Extended: Indent rows intersecting selections by one level.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor.
  indentSelectedRows(options = {}) {
    if (!this.ensureWritable('indentSelectedRows', options)) return;
    return this.mutateSelectedText(selection =>
      selection.indentSelectedRows(options)
    );
  }

  // Extended: Outdent rows intersecting selections by one level.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor.
  outdentSelectedRows(options = {}) {
    if (!this.ensureWritable('outdentSelectedRows', options)) return;
    return this.mutateSelectedText(selection =>
      selection.outdentSelectedRows(options)
    );
  }

  // Extended: Get the indentation level of the given line of text.
  //
  // Determines how deeply the given line is indented based on the soft tabs and
  // tab length settings of this editor. Note that if soft tabs are enabled and
  // the tab length is 2, a row with 4 leading spaces would have an indentation
  // level of 2.
  //
  // * `line` A {String} representing a line of text.
  //
  // Returns a {Number}.
  indentLevelForLine(line) {
    const tabLength = this.getTabLength();
    let indentLength = 0;
    for (let i = 0, { length } = line; i < length; i++) {
      const char = line[i];
      if (char === '\t') {
        indentLength += tabLength - (indentLength % tabLength);
      } else if (char === ' ') {
        indentLength++;
      } else {
        break;
      }
    }
    return indentLength / tabLength;
  }

  // Extended: Indent rows intersecting selections based on the grammar's suggested
  // indent level.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor.
  autoIndentSelectedRows(options = {}) {
    if (!this.ensureWritable('autoIndentSelectedRows', options)) return;
    return this.mutateSelectedText(selection =>
      selection.autoIndentSelectedRows(options)
    );
  }

  // Indent all lines intersecting selections. See {Selection::indent} for more
  // information.
  //
  // * `options` (optional) {Object}
  //   * `bypassReadOnly` (optional) {Boolean} Must be `true` to modify a read-only editor.
  indent(options = {}) {
    if (!this.ensureWritable('indent', options)) return;
    if (options.autoIndent == null)
      options.autoIndent = this.shouldAutoIndent();
    this.mutateSelectedText(selection => selection.indent(options));
  }

  // Constructs the string used for indents.
  buildIndentString(level, column = 0) {
    if (this.getSoftTabs()) {
      const tabStopViolation = column % this.getTabLength();
      return _.multiplyString(
        ' ',
        Math.floor(level * this.getTabLength()) - tabStopViolation
      );
    } else {
      const excessWhitespace = _.multiplyString(
        ' ',
        Math.round((level - Math.floor(level)) * this.getTabLength())
      );
      return _.multiplyString('\t', Math.floor(level)) + excessWhitespace;
    }
  }

  /*
  Section: Config
  */

  // Experimental: Is auto-indentation enabled for this editor?
  //
  // Returns a {Boolean}.
  shouldAutoIndent() {
    return this.autoIndent;
  }

  // Experimental: Is auto-indentation on paste enabled for this editor?
  //
  // Returns a {Boolean}.
  shouldAutoIndentOnPaste() {
    return this.autoIndentOnPaste;
  }

  // Experimental: Does this editor allow scrolling past the last line?
  //
  // Returns a {Boolean}.
  getScrollPastEnd() {
    if (this.getAutoHeight()) {
      return false;
    } else {
      return this.scrollPastEnd;
    }
  }

  // Experimental: How fast does the editor scroll in response to mouse wheel
  // movements?
  //
  // Returns a positive {Number}.
  getScrollSensitivity() {
    return this.scrollSensitivity;
  }

  // Experimental: Does this editor show cursors while there is a selection?
  //
  // Returns a positive {Boolean}.
  getShowCursorOnSelection() {
    return this.showCursorOnSelection;
  }

  // Experimental: Are line numbers enabled for this editor?
  //
  // Returns a {Boolean}
  doesShowLineNumbers() {
    return this.showLineNumbers;
  }

  // Experimental: Get the time interval within which text editing operations
  // are grouped together in the editor's undo history.
  //
  // Returns the time interval {Number} in milliseconds.
  getUndoGroupingInterval() {
    return this.undoGroupingInterval;
  }

  // Experimental: Get the characters that are *not* considered part of words,
  // for the purpose of word-based cursor movements.
  //
  // Returns a {String} containing the non-word characters.
  getNonWordCharacters(position) {
    const languageMode = this.buffer.getLanguageMode();
    return (
      (languageMode.getNonWordCharacters &&
        languageMode.getNonWordCharacters(position || Point(0, 0))) ||
      DEFAULT_NON_WORD_CHARACTERS
    );
  }

  /*
  Section: Utility
  */

  inspect() {
    return `<TextEditor ${this.id}>`;
  }

  emitWillInsertTextEvent(text) {
    let result = true;
    const cancel = () => {
      result = false;
    };
    this.emitter.emit('will-insert-text', { cancel, text });
    return result;
  }

  /*
  Section: Language Mode Delegated Methods
  */

  suggestedIndentForBufferRow(bufferRow, options) {
    const languageMode = this.buffer.getLanguageMode();
    return (
      languageMode.suggestedIndentForBufferRow &&
      languageMode.suggestedIndentForBufferRow(
        bufferRow,
        this.getTabLength(),
        options
      )
    );
  }

  // Given a buffer row, indent it.
  //
  // * bufferRow - The row {Number}.
  // * options - An options {Object} to pass through to {TextEditor::setIndentationForBufferRow}.
  autoIndentBufferRow(bufferRow, options) {
    const indentLevel = this.suggestedIndentForBufferRow(bufferRow, options);
    return this.setIndentationForBufferRow(bufferRow, indentLevel, options);
  }

  // Indents all the rows between two buffer row numbers.
  //
  // * startRow - The row {Number} to start at
  // * endRow - The row {Number} to end at
  autoIndentBufferRows(startRow, endRow) {
    let row = startRow;
    while (row <= endRow) {
      this.autoIndentBufferRow(row);
      row++;
    }
  }

  autoDecreaseIndentForBufferRow(bufferRow) {
    const languageMode = this.buffer.getLanguageMode();
    const indentLevel =
      languageMode.suggestedIndentForEditedBufferRow &&
      languageMode.suggestedIndentForEditedBufferRow(
        bufferRow,
        this.getTabLength()
      );
    if (indentLevel != null)
      this.setIndentationForBufferRow(bufferRow, indentLevel);
  }

  toggleLineCommentForBufferRow(row) {
    this.toggleLineCommentsForBufferRows(row, row);
  }

  toggleLineCommentsForBufferRows(start, end, options = {}) {
    const languageMode = this.buffer.getLanguageMode();
    let { commentStartString, commentEndString } =
      (languageMode.commentStringsForPosition &&
        languageMode.commentStringsForPosition(new Point(start, 0))) ||
      {};
    if (!commentStartString) return;
    commentStartString = commentStartString.trim();

    if (commentEndString) {
      commentEndString = commentEndString.trim();
      const startDelimiterColumnRange = columnRangeForStartDelimiter(
        this.buffer.lineForRow(start),
        commentStartString
      );
      if (startDelimiterColumnRange) {
        const endDelimiterColumnRange = columnRangeForEndDelimiter(
          this.buffer.lineForRow(end),
          commentEndString
        );
        if (endDelimiterColumnRange) {
          this.buffer.transact(() => {
            this.buffer.delete([
              [end, endDelimiterColumnRange[0]],
              [end, endDelimiterColumnRange[1]]
            ]);
            this.buffer.delete([
              [start, startDelimiterColumnRange[0]],
              [start, startDelimiterColumnRange[1]]
            ]);
          });
        }
      } else {
        this.buffer.transact(() => {
          const indentLength = this.buffer.lineForRow(start).match(/^\s*/)[0]
            .length;
          this.buffer.insert([start, indentLength], commentStartString + ' ');
          this.buffer.insert(
            [end, this.buffer.lineLengthForRow(end)],
            ' ' + commentEndString
          );

          // Prevent the cursor from selecting / passing the delimiters
          // See https://github.com/atom/atom/pull/17519
          if (options.correctSelection && options.selection) {
            const endLineLength = this.buffer.lineLengthForRow(end);
            const oldRange = options.selection.getBufferRange();
            if (oldRange.isEmpty()) {
              if (oldRange.start.column === endLineLength) {
                const endCol = endLineLength - commentEndString.length - 1;
                options.selection.setBufferRange(
                  [[end, endCol], [end, endCol]],
                  { autoscroll: false }
                );
              }
            } else {
              const startDelta =
                oldRange.start.column === indentLength
                  ? [0, commentStartString.length + 1]
                  : [0, 0];
              const endDelta =
                oldRange.end.column === endLineLength
                  ? [0, -commentEndString.length - 1]
                  : [0, 0];
              options.selection.setBufferRange(
                oldRange.translate(startDelta, endDelta),
                { autoscroll: false }
              );
            }
          }
        });
      }
    } else {
      let hasCommentedLines = false;
      let hasUncommentedLines = false;
      for (let row = start; row <= end; row++) {
        const line = this.buffer.lineForRow(row);
        if (NON_WHITESPACE_REGEXP.test(line)) {
          if (columnRangeForStartDelimiter(line, commentStartString)) {
            hasCommentedLines = true;
          } else {
            hasUncommentedLines = true;
          }
        }
      }

      const shouldUncomment = hasCommentedLines && !hasUncommentedLines;

      if (shouldUncomment) {
        for (let row = start; row <= end; row++) {
          const columnRange = columnRangeForStartDelimiter(
            this.buffer.lineForRow(row),
            commentStartString
          );
          if (columnRange)
            this.buffer.delete([[row, columnRange[0]], [row, columnRange[1]]]);
        }
      } else {
        let minIndentLevel = Infinity;
        let minBlankIndentLevel = Infinity;
        for (let row = start; row <= end; row++) {
          const line = this.buffer.lineForRow(row);
          const indentLevel = this.indentLevelForLine(line);
          if (NON_WHITESPACE_REGEXP.test(line)) {
            if (indentLevel < minIndentLevel) minIndentLevel = indentLevel;
          } else {
            if (indentLevel < minBlankIndentLevel)
              minBlankIndentLevel = indentLevel;
          }
        }
        minIndentLevel = Number.isFinite(minIndentLevel)
          ? minIndentLevel
          : Number.isFinite(minBlankIndentLevel)
          ? minBlankIndentLevel
          : 0;

        const indentString = this.buildIndentString(minIndentLevel);
        for (let row = start; row <= end; row++) {
          const line = this.buffer.lineForRow(row);
          if (NON_WHITESPACE_REGEXP.test(line)) {
            const indentColumn = columnForIndentLevel(
              line,
              minIndentLevel,
              this.getTabLength()
            );
            this.buffer.insert(
              Point(row, indentColumn),
              commentStartString + ' '
            );
          } else {
            this.buffer.setTextInRange(
              new Range(new Point(row, 0), new Point(row, Infinity)),
              indentString + commentStartString + ' '
            );
          }
        }
      }
    }
  }

  rowRangeForParagraphAtBufferRow(bufferRow) {
    if (!NON_WHITESPACE_REGEXP.test(this.lineTextForBufferRow(bufferRow)))
      return;

    const languageMode = this.buffer.getLanguageMode();
    const isCommented = languageMode.isRowCommented(bufferRow);

    let startRow = bufferRow;
    while (startRow > 0) {
      if (!NON_WHITESPACE_REGEXP.test(this.lineTextForBufferRow(startRow - 1)))
        break;
      if (languageMode.isRowCommented(startRow - 1) !== isCommented) break;
      startRow--;
    }

    let endRow = bufferRow;
    const rowCount = this.getLineCount();
    while (endRow + 1 < rowCount) {
      if (!NON_WHITESPACE_REGEXP.test(this.lineTextForBufferRow(endRow + 1)))
        break;
      if (languageMode.isRowCommented(endRow + 1) !== isCommented) break;
      endRow++;
    }

    return new Range(
      new Point(startRow, 0),
      new Point(endRow, this.buffer.lineLengthForRow(endRow))
    );
  }
}

function columnForIndentLevel(line, indentLevel, tabLength) {
  let column = 0;
  let indentLength = 0;
  const goalIndentLength = indentLevel * tabLength;
  while (indentLength < goalIndentLength) {
    const char = line[column];
    if (char === '\t') {
      indentLength += tabLength - (indentLength % tabLength);
    } else if (char === ' ') {
      indentLength++;
    } else {
      break;
    }
    column++;
  }
  return column;
}

function columnRangeForStartDelimiter(line, delimiter) {
  const startColumn = line.search(NON_WHITESPACE_REGEXP);
  if (startColumn === -1) return null;
  if (!line.startsWith(delimiter, startColumn)) return null;

  let endColumn = startColumn + delimiter.length;
  if (line[endColumn] === ' ') endColumn++;
  return [startColumn, endColumn];
}

function columnRangeForEndDelimiter(line, delimiter) {
  let startColumn = line.lastIndexOf(delimiter);
  if (startColumn === -1) return null;

  const endColumn = startColumn + delimiter.length;
  if (NON_WHITESPACE_REGEXP.test(line.slice(endColumn))) return null;
  if (line[startColumn - 1] === ' ') startColumn--;
  return [startColumn, endColumn];
}

export default TextEditor;
