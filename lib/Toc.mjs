/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS203: Remove `|| {}` from converted for-own loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
class Toc {
  constructor(editor) {
    this.editor = editor;
    this.lines = [];
    this.list = [];
    this.options = {
      depthFrom: 1, // depthFrom
      depthTo: 6, // depthTo
      withLinks: 1, // withLinks
      updateOnSave: 1, // updateOnSave
      orderedList: 0 // orderedList
    };
  }

  // ----------------------------------------------------------------------------
  // main methods (highest logic level)
  //
  //
  // create() {
  //   if (this._hasToc()) {
  //     this._deleteToc();
  //     this.editor.setTextInBufferRange([[this.open,0], [this.open,0]], this._createToc());
  //   }
  //   // return this.editor.insertText(this._createToc());
  // }

  update() {
    if (this._hasToc()) {
      this._deleteToc();
      return this.editor.setTextInBufferRange(
        [
          [this.open, 0],
          [this.open, 0]
        ],
        this._createToc()
      );
    } else {
      console.error("No TOC section");
    }
  }

  // delete() {
  //   if (this._hasToc()) {
  //     return this._deleteToc();
  //   }
  // }
  //
  // toggle() {
  //   if (this._hasToc()) {
  //     return this._deleteToc();
  //   } else {
  //     return this.create()
  //   }
  // }

  // ----------------------------------------------------------------------------

  _hasToc() {
    this.___updateLines();

    if (this.lines.length > 0) {
      this.open = false;
      this.close = false;
      let options = undefined;

      for (let i in this.lines) {
        const line = this.lines[i];
        if (this.open === false) {
          if (line.match(/^<!--(.*)TOC(.*)-->$/g)) {
            this.open = parseInt(i);
            options = line;
          }
        } else {
          if (line.match(/^<!--(.*)\/TOC(.*)-->$/g)) {
            this.close = parseInt(i);
            break;
          }
        }
      }

      if (this.open !== false && this.close !== false) {
        if (options !== undefined) {
          this.__updateOptions(options);
          return true;
        }
      }
    }
    return false;
  }

  // embed list with the open and close comment:
  // <!-- TOC --> [list] <!-- /TOC -->
  _createToc() {
    this.__updateList();
    if (Object.keys(this.list).length > 0) {
      const text = [];
      text.push(
        "<!-- TOC depthFrom:" +
          this.options.depthFrom +
          " depthTo:" +
          this.options.depthTo +
          " withLinks:" +
          this.options.withLinks +
          " updateOnSave:" +
          this.options.updateOnSave +
          " orderedList:" +
          this.options.orderedList +
          " -->\n"
      );
      const list = this.__createList();
      if (list !== false) {
        Array.prototype.push.apply(text, list);
      }
      text.push("\n<!-- /TOC -->");
      return text.join("\n");
    }
    return "";
  }

  _deleteToc() {
    return this.editor.setTextInBufferRange(
      [
        [this.open, 0],
        [this.close, 14]
      ],
      ""
    );
  }

  // ----------------------------------------------------------------------------

  // parse all lines and find markdown headlines
  __updateList() {
    this.___updateLines();
    this.list = [];
    let isInCodeBlock = false;
    return (() => {
      const result1 = [];
      for (let i in this.lines) {
        const line = this.lines[i];
        if (line.match(/^```/)) {
          isInCodeBlock = !isInCodeBlock;
        }
        if (isInCodeBlock) {
          continue;
        }
        const result = line.match(/^\#{1,6}/);
        if (result) {
          const depthFrom =
            this.options.depthFrom !== undefined ? this.options.depthFrom : 1;
          const depthTo =
            this.options.depthTo !== undefined ? this.options.depthTo : 6;
          if (
            result[0].length <= parseInt(depthTo) &&
            result[0].length >= parseInt(depthFrom)
          ) {
            result1.push(
              this.list.push({
                depth: result[0].length,
                line: new String(line)
              })
            );
          } else {
            result1.push(undefined);
          }
        } else {
          result1.push(undefined);
        }
      }
      return result1;
    })();
  }

  // create hierarchical markdown list
  __createList() {
    const list = [];
    const depthFrom =
      this.options.depthFrom !== undefined ? this.options.depthFrom : 1;
    const depthTo =
      this.options.depthTo !== undefined ? this.options.depthTo : 6;
    let indicesOfDepth = Array.apply(
      null,
      new Array(depthTo - depthFrom + 1)
    ).map(Number.prototype.valueOf, 0);
    for (let i of Object.keys(this.list || {})) {
      var item = this.list[i];
      const row = [];
      for (
        let tab = depthFrom, end = item.depth, asc = depthFrom <= end;
        asc ? tab <= end : tab >= end;
        asc ? tab++ : tab--
      ) {
        if (tab > depthFrom) {
          row.push("\t");
        }
      }
      if (this.options.orderedList === 1) {
        row.push(++indicesOfDepth[item.depth - 1] + ". ");
        indicesOfDepth = indicesOfDepth.map(function(value, index) {
          if (index < item.depth) {
            return value;
          } else {
            return 0;
          }
        });
      } else {
        row.push("- ");
      }

      let line = item.line.substr(item.depth);
      line = line.trim();
      if (this.options.withLinks === 1) {
        row.push(this.___createLink(line));
      } else {
        row.push(line);
      }

      list.push(row.join(""));
    }
    if (list.length > 0) {
      return list;
    }
    return false;
  }

  __updateOptions(line) {
    const options = line.match(/(\w+(=|:)(\d|yes|no))+/g);
    if (options) {
      this.options = {};
      return (() => {
        const result = [];
        for (let i in options) {
          const option = options[i];

          let key = option.match(/^(\w+)/g);
          key = new String(key[0]);

          let value = option.match(/(\d|yes|no)$/g);
          value = new String(value[0]);
          if (value.length > 1) {
            if (value.toLowerCase().valueOf() === new String("yes").valueOf()) {
              value = 1;
            } else {
              value = 0;
            }
          }

          if (
            key.toLowerCase().valueOf() === new String("depthfrom").valueOf()
          ) {
            result.push((this.options.depthFrom = parseInt(value)));
          } else if (
            key.toLowerCase().valueOf() === new String("depthto").valueOf()
          ) {
            result.push((this.options.depthTo = parseInt(value)));
          } else if (
            key.toLowerCase().valueOf() === new String("withlinks").valueOf()
          ) {
            result.push((this.options.withLinks = parseInt(value)));
          } else if (
            key.toLowerCase().valueOf() === new String("updateonsave").valueOf()
          ) {
            result.push((this.options.updateOnSave = parseInt(value)));
          } else if (
            key.toLowerCase().valueOf() === new String("orderedlist").valueOf()
          ) {
            result.push((this.options.orderedList = parseInt(value)));
          } else {
            result.push(undefined);
          }
        }
        return result;
      })();
    }
  }

  // ----------------------------------------------------------------------------
  // lightweight methods

  // update raw lines after initialization or changes
  ___updateLines() {
    if (this.editor !== undefined) {
      return (this.lines = this.editor.getBuffer().getLines());
    } else {
      return (this.lines = []);
    }
  }

  // create hash and surround link withit
  ___createLink(name) {
    let hash = new String(name);
    hash = hash.toLowerCase().replace(/\s/g, "-");
    hash = hash.replace(/[^a-z0-9\u4e00-\u9fa5äüö\-]/g, "");
    if (hash.indexOf("--") > -1) {
      hash = hash.replace(/(-)+/g, "-");
    }
    if (name.indexOf(":-") > -1) {
      hash = hash.replace(/:-/g, "-");
    }
    const link = [];
    link.push("[");
    link.push(name);
    link.push("](#");
    link.push(hash);
    link.push(")");
    return link.join("");
  }
}

export default Toc;
