import { accountScript, encode } from './prelude.mjs'

// Finds one Library artifact by exact provider id and/or exact canonical
// filename. The action button's aria-label is control metadata, not generated
// content. Ambiguous matches fail closed; fuzzy/truncated labels never match.
export function chatGPTLibraryArtifactRectScript(canonicalFilename, artifactId = '') {
  const wantedName = encode(String(canonicalFilename || '').trim())
  const wantedID = encode(String(artifactId || '').trim())
  return accountScript(`
    const wantedName = ${wantedName};
    const wantedID = ${wantedID};
    const rows = [...document.querySelectorAll('div[role="row"][data-page-table-selection-id]')].filter(visible);
    const parseName = (button) => {
      const raw = String(button?.getAttribute?.('aria-label') || '').trim();
      const prefix = 'Open actions menu for ';
      return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : '';
    };
    const matches = [];
    for (const row of rows) {
      const id = String(row.getAttribute('data-page-table-selection-id') || '').trim();
      const action = [...row.querySelectorAll('button[aria-label^="Open actions menu for "]')].find((node) => usable(node) && visible(node));
      if (!action) continue;
      const name = parseName(action);
      const idOK = !wantedID || id === wantedID;
      const nameOK = !wantedName || name === wantedName;
      if (idOK && nameOK) matches.push({ row, action, id, name });
    }
    if (!matches.length) return { ok: false, state: 'artifact-missing', rows: rows.length };
    if (matches.length !== 1) return { ok: false, state: 'artifact-ambiguous', matches: matches.length };
    const point = rect(matches[0].action);
    return point ? { ok: true, state: 'artifact-located', rect: point, artifactId: matches[0].id, canonicalFilename: matches[0].name }
      : { ok: false, state: 'artifact-offscreen', viewport: viewport() };
  `)
}

export function chatGPTLibraryArtifactStateScript(canonicalFilename, artifactId = '') {
  const wantedName = encode(String(canonicalFilename || '').trim())
  const wantedID = encode(String(artifactId || '').trim())
  return accountScript(`
    const wantedName = ${wantedName};
    const wantedID = ${wantedID};
    const rows = [...document.querySelectorAll('div[role="row"][data-page-table-selection-id]')].filter(visible);
    const names = rows.map((row) => {
      const button = row.querySelector('button[aria-label^="Open actions menu for "]');
      const raw = String(button?.getAttribute?.('aria-label') || '').trim();
      const prefix = 'Open actions menu for ';
      return { id: String(row.getAttribute('data-page-table-selection-id') || '').trim(), name: raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : '' };
    });
    const matches = names.filter((item) => (!wantedID || item.id === wantedID) && (!wantedName || item.name === wantedName));
    return { ok: true, state: matches.length ? 'artifact-present' : 'artifact-absent', matches: matches.length, rows: rows.length };
  `)
}

// Confirms a destructive action only inside ChatGPT's visible confirmation
// dialog. The caller must first address the exact conversation menu by id.
export function chatGPTConfirmDeleteScript() {
  return accountScript(`
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
    if (!dialog) return { ok: false, state: 'delete-dialog-unavailable' };
    const buttons = [...dialog.querySelectorAll('button')].filter((node) => usable(node) && visible(node));
    const wanted = ['delete','apagar','eliminar','supprimer','löschen'];
    const button = buttons.find((node) => wanted.some((value) => label(node).toLocaleLowerCase() === value))
      || buttons.find((node) => wanted.some((value) => label(node).toLocaleLowerCase().startsWith(value)));
    if (!button) return { ok: false, state: 'delete-confirm-unavailable', available: buttons.map(label).slice(0, 8) };
    const point = rect(button);
    return point ? { ok: true, state: 'delete-confirm-located', rect: point } : { ok: false, state: 'delete-confirm-offscreen', viewport: viewport() };
  `)
}
