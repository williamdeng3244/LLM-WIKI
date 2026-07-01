// Copy text to the clipboard, working on plain HTTP too.
//
// `navigator.clipboard` only exists in a "secure context" (HTTPS or
// localhost). On an internal company deploy served over plain HTTP it is
// `undefined`, so `navigator.clipboard.writeText(...)` throws and the copy
// silently fails (the MCP token "copy" button, page/artifact link copies,
// etc. all did nothing). Fall back to a hidden <textarea> + execCommand.
//
// Returns true on success so callers can drive their "Copied!" UI off the
// actual result instead of assuming it worked.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or non-secure context — fall through to execCommand.
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
