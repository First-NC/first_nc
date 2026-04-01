import Editor, { loader } from "@monaco-editor/react";
import * as monacoApi from "monaco-editor";
import type * as Monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { resolveNcEditorOptions } from "../lib/editorOptions";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (moduleId: string, label: string) => Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker(_moduleId: string, _label: string) {
    return new EditorWorker({ name: "monaco-editor-worker" });
  },
};

loader.config({ monaco: monacoApi });

export type NcEditorProps = {
  path: string;
  theme: string;
  value: string;
  onMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
  onChange: (value: string | undefined) => void;
};

export default function NcEditor({ path, theme, value, onMount, onChange }: NcEditorProps) {
  return (
    <Editor
      path={path}
      width="100%"
      height="100%"
      language="ncgcode"
      theme={theme}
      value={value}
      onMount={onMount}
      onChange={onChange}
      options={resolveNcEditorOptions()}
    />
  );
}
