/** One acceptance contract for the installed smoke runner and candidate preparation. */
export const installedAcceptanceFields = [
  'installedPackage', 'workspaceBound', 'unsavedReference', 'draftRestored', 'desktopUnchanged',
  'ownedRuntimeExited', 'sharedLogin', 'sharedSignOut', 'loadingDismissed',
];

/** @param {Record<string, unknown>} result @param {string} version */
export function passedInstalledAcceptance(result, version) {
  return result.vscodeVersion === version && installedAcceptanceFields.every(field => result[field] === true) &&
    result.interceptedPrompts === 1 && result.generationCalls === 0;
}
