export function resolveNcEditorOptions() {
  return {
    minimap: { enabled: false },
    fontSize: 13,
    folding: true,
    glyphMargin: true,
    smoothScrolling: true,
    lineNumbers: "on" as const,
    automaticLayout: true,
    wordWrap: "off" as const,
    scrollbar: {
      horizontal: "auto" as const,
      horizontalScrollbarSize: 10,
      alwaysConsumeMouseWheel: false,
    },
    scrollBeyondLastColumn: 4,
    scrollBeyondLastLine: false,
  };
}
