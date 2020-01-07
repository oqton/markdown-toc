import Toc from "./Toc.mjs";
import TextEditor from "./TextEditor.mjs";

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
