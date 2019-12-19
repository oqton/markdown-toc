#!/usr/bin/env node --experimental-modules
import Toc from "./Toc";
import TextEditor from "./TextEditor";

async function main() {
  try {
    const editor = new TextEditor();
    await editor.load(process.argv[2]);
    const toc = new Toc(editor);
    toc.update();
    await editor.save();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
