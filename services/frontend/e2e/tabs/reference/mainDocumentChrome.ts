// Frozen document chrome from main e8dbf4bb; a visual regression reference.
export const mainDocumentChrome = String.raw`
* { box-sizing: border-box; }
.editor-tab { height: 39px; max-width: 65%; display: flex; align-items: center; gap: 6px; padding: 0 12px; color: #555a50; border-right: 1px solid #cdd1c5; font: 10px ui-monospace, 'SFMono-Regular', Consolas, monospace; }
.editor-tab.active { background: #fafaf6; color: #242720; border-top: 2px solid #648f26; }
.editor-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dirty-dot { width: 6px; height: 6px; background: #7aa536; border-radius: 50%; }
.editor-tabs-scroll { min-width: 0; flex: 1; height: 38px; display: flex; align-items: stretch; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.editor-tab { flex: 0 0 auto; width: auto; max-width: 230px; height: 38px; padding: 0 8px 0 10px; border: 0; border-right: 1px solid #30342d; border-top: 2px solid transparent; background: #1d201b; color: #8f9789; cursor: pointer; }
.editor-tab.active { background: #151713; color: #d4dacd; border-top-color: #9acb52; }
.editor-tab:hover { background: #242821; color: #c4cbbd; }
.editor-tab > span { min-width: 0; max-width: 150px; }
.editor-tab-close { width: 18px; height: 18px; margin-left: 2px; display: grid; place-items: center; border-radius: 4px; color: #6f776a; font: 400 14px/1 sans-serif; }
.editor-tab-close:hover { background: #373c34; color: #d6ddcf; }
.editor-tab .dirty-dot { margin-left: 2px; }
.editor-tab { border-radius: 0; }
.editor-tab.active { box-shadow: inset 0 -2px var(--theme-accent); }
:root[data-density='compact'] .editor-tab { min-height: 28px; }
.file-glyph { width:15px; height:15px; flex:0 0 15px; display:inline-grid; place-items:center; color:var(--theme-text-muted); }
.file-glyph-env { color:#c59b38; }
.file-glyph-docker { color:#2496ed; }
.file-glyph-package, .file-glyph-json { color:#c8a650; }
.file-glyph-typescript { color:#4f9cf9; }
.file-glyph-javascript { color:#d8bc42; }
.file-glyph-style { color:#b477db; }
.file-glyph-markup { color:#e47854; }
.file-glyph-markdown { color:#64a8d8; }
.file-glyph-config { color:#8aa08a; }
.file-glyph-shell { color:#7ab66f; }
.file-glyph-php { color:#8c91c8; }
.file-glyph-go { color:#4cb9ca; }
.file-glyph-python { color:#d7ae45; }
.file-glyph-database { color:#69a5d8; }
.editor-tab { position: relative; border: 0; border-right: 1px solid var(--theme-border-soft); border-radius: 0; background: transparent; color: var(--theme-text-muted); box-shadow: none; }
.editor-tab:hover { background: color-mix(in srgb, var(--theme-hover) 64%, transparent); color: var(--theme-text-soft); }
.editor-tab.active { border-top-color: transparent; background: color-mix(in srgb, var(--theme-accent-soft) 48%, var(--theme-surface)); color: var(--theme-text); box-shadow: inset 0 -2px var(--theme-accent), inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 22%, var(--theme-border)); font-weight: 700; }
.editor-tabs-scroll { gap: 0; }
.editor-tab:not([data-dragging='true']) { border-right-color: transparent; background: transparent; transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, box-shadow var(--motion-fast) ease; }
.editor-tab.active:not([data-dragging='true']) { border-color: transparent; background: transparent; box-shadow: inset 0 -2px var(--theme-accent); }
.workspace-main-row > .agent-activity-bar button, .editor-tab:not([data-dragging='true']), .terminal-workspace:not(.terminal-workspace-hidden), .terminal-tab-action, .terminal-add-tab, .chat-panel .composer, .agent-runtime-list > button { transition: none; }
.editor-tabs-scroll { height: 100%; align-items: stretch; }
.editor-tab:not([data-dragging='true']) { min-width: 0; height: 36px; padding: 0 10px; gap: 6px; border-right: 1px solid var(--theme-border-soft); background: transparent; color: var(--theme-text-muted); font-weight: 500; }
.editor-tab:hover:not([data-dragging='true']) { background: color-mix(in srgb, var(--theme-hover) 54%, transparent); color: var(--theme-text-soft); }
.editor-tab.active:not([data-dragging='true']) { background: transparent; color: var(--theme-text); font-weight: 500; box-shadow: inset 0 -2px var(--theme-accent); }
.editor-tab-close { opacity: .18; transition: opacity var(--motion-fast) ease, color var(--motion-fast) ease; }
.editor-tab:hover .editor-tab-close, .editor-tab.active .editor-tab-close { opacity: .7; }
.file-glyph { width: 18px; height: 18px; flex: 0 0 18px; border-radius: 3px; }
.file-glyph > svg { width: 14px; height: 14px; stroke-width: 1.75; }
.file-glyph-mark { width: 17px; height: 17px; display: inline-grid; place-items: center; border: 1px solid color-mix(in srgb, currentColor 34%, transparent); border-radius: 3px; background: color-mix(in srgb, currentColor 8%, transparent); font: 750 calc(6.2px * var(--ui-font-scale))/1 var(--mono-font-family); letter-spacing: -.04em; }
.agent-tree-row:hover .file-glyph, .agent-tree-row.selected-node .file-glyph { filter: saturate(1.12) brightness(1.06); }
.agent-tree-row .file-glyph > svg { width: 15px; height: 15px; }
:root[data-theme='light'] .editor-tab { border-color: var(--theme-border); background: #e9ece5; color: #687265; }
:root[data-theme='light'] .editor-tab.active { border-top-color: transparent; background: color-mix(in srgb, var(--theme-accent-soft) 58%, #f7f8f4); color: #242a21; box-shadow: inset 0 -2px var(--theme-accent), inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 24%, var(--theme-border)); }
:root[data-theme='light'] .editor-tab:hover { background: #f0f2ed; color: #3f473c; }
:root[data-theme='light'] .editor-tab-close { color: #818a7e; }
:root[data-theme='light'] .editor-tab-close:hover { background: #dce1d8; color: #343c31; }
:root[data-theme='dark'] .editor-tab { border-color: #383838; background: #292929; color: #aaa; }
:root[data-theme='dark'] .editor-tab.active { border-top-color: transparent; background: color-mix(in srgb, var(--theme-accent-soft) 62%, #212121); color: #f2f2f2; box-shadow: inset 0 -2px var(--theme-accent), inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 30%, #383838); }
:root[data-theme='dark'] .editor-tab:hover { background: #303030; color: #dedede; }
:root[data-theme='dark'] .message-tools button, :root[data-theme='dark'] .icon-button.light, :root[data-theme='dark'] .editor-tab, :root[data-theme='dark'] .tree-row, :root[data-theme='dark'] .agent-tree-row, :root[data-theme='dark'] .terminal-controls, :root[data-theme='dark'] .execution-log-line time { color: #b8b8b8; }
:root[data-ui-theme]:not([data-ui-theme='original']) .agent-tree-row:hover, :root[data-ui-theme]:not([data-ui-theme='original']) .workspace-side-rail button:hover, :root[data-ui-theme]:not([data-ui-theme='original']) .editor-tab:hover { background:var(--theme-hover); color:var(--theme-text); }
`
