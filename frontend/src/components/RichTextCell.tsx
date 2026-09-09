import { useRef, useEffect, useCallback } from "react";
import { toTitleCase } from "../lib/billMath";

type Props = {
  value: string; // HTML string (e.g. "Hello <b>World</b>")
  onChange: (html: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  /** Allow Enter to insert a line break (for Note / Address fields). */
  multiline?: boolean;
  /** Auto-capitalize each word on blur (Title Case), preserving bold markup. */
  titleCase?: boolean;
};

/**
 * A contentEditable cell that supports inline bold formatting.
 * Works like Excel/Word: select text, press Ctrl+B or click the Bold button
 * in the toolbar, and only the selected text becomes bold.
 *
 * Stores value as simple HTML: text plus <b> and <br> tags only.
 */
export function RichTextCell({ value, onChange, onFocus, placeholder, style, className, multiline, titleCase }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const lastHtml = useRef(value);

  // Sync external value into the DOM only when the incoming value genuinely
  // differs from what this cell last emitted. Comparing against lastHtml (not
  // the live innerHTML) avoids overwriting the DOM — and resetting the caret —
  // on re-renders caused by unrelated state changes.
  useEffect(() => {
    if (!ref.current) return;
    if (value === lastHtml.current) return;        // nothing new for us
    if (document.activeElement === ref.current) {  // user is mid-edit here
      lastHtml.current = value;                    // trust our own emitted value
      return;                                      // don't stomp the caret
    }
    ref.current.innerHTML = normalizeIncoming(value);
    lastHtml.current = value;
  }, [value]);

  // Set initial content
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = normalizeIncoming(value);
    lastHtml.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitChange = useCallback(() => {
    if (!ref.current) return;
    const html = sanitize(ref.current.innerHTML);
    if (html !== lastHtml.current) {
      lastHtml.current = html;
      onChange(html);
    }
  }, [onChange]);

  const handleInput = () => {
    if (isComposing.current) return;
    emitChange();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+B / Cmd+B toggles bold on the selected text (or entire cell if nothing selected)
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        // Toggle bold on the entire cell if no text is specifically selected
        if (ref.current) {
          const range = document.createRange();
          range.selectNodeContents(ref.current);
          sel?.removeAllRanges();
          sel?.addRange(range);
          applyBold();
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      } else {
        applyBold();
      }
      requestAnimationFrame(emitChange);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (multiline) {
        document.execCommand("insertLineBreak");
        emitChange();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const withBreaks = multiline ? text.replace(/\r\n|\r|\n/g, "<br>") : text.replace(/\r\n|\r|\n/g, " ");
    document.execCommand("insertHTML", false, withBreaks);
    emitChange();
  };

  const handleBlur = () => {
    if (titleCase && ref.current) {
      applyTitleCaseToDom(ref.current);
    }
    emitChange();
  };

  const editable = (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; emitChange(); }}
      onFocus={onFocus}
      onBlur={handleBlur}
      data-placeholder={placeholder}
      style={{
        minHeight: "1.4em",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        ...style,
      }}
    />
  );

  return editable;
}

/**
 * Ask the browser to use <b> tags rather than inline CSS spans, then bold the
 * current selection. Without styleWithCSS=false Chrome emits
 * <span style="font-weight:bold"> which is harder to round-trip.
 */
function applyBold(): void {
  try { document.execCommand("styleWithCSS", false, "false"); } catch { /* not supported */ }
  document.execCommand("bold", false);
}

/**
 * Toggle bold on the current selection (called from the external Bold button).
 * Restores focus to the editable element that owns the selection, applies bold,
 * then fires an input event so the owning RichTextCell saves the change.
 */
export function toggleBoldSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  // Walk up to the contentEditable host of the selection
  let node: Node | null = sel.anchorNode;
  let host: HTMLElement | null = null;
  while (node) {
    if (node instanceof HTMLElement && node.isContentEditable) { host = node; break; }
    node = node.parentNode;
  }
  if (!host) return;

  if (sel.isCollapsed) {
    // If no specific text is highlighted, toggle bold on the entire cell
    host.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(host);
    sel.removeAllRanges();
    sel.addRange(range);
    applyBold();
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    setTimeout(() => {
      host.dispatchEvent(new Event("input", { bubbles: true }));
    }, 0);
    return;
  }

  // Preserve the exact selection range, because focusing the host can collapse
  // the caret and make execCommand("bold") a no-op.
  const savedRange = sel.getRangeAt(0).cloneRange();
  if (document.activeElement !== host) {
    host.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  applyBold();
  // Delay so the DOM mutation from execCommand settles before serializing.
  setTimeout(() => {
    host.dispatchEvent(new Event("input", { bubbles: true }));
  }, 0);
}

/**
 * Apply Title Case to every text node inside the element, in place.
 * Because we only touch text-node contents, existing <b> and <br> markup
 * (i.e. bold runs and line breaks) is left untouched.
 */
function applyTitleCaseToDom(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }
  textNodes.forEach(tn => {
    const original = tn.textContent || "";
    if (!original.trim()) return;
    const cased = toTitleCase(original);
    if (cased !== original) tn.textContent = cased;
  });
}

/** Prepare a stored value for injection into the DOM. */
function normalizeIncoming(value: string): string {
  if (!value) return "";
  // Legacy values may contain raw newlines; show them as line breaks.
  return value.replace(/\r\n|\r|\n/g, "<br>");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Serialize the editable DOM down to text plus <b> and <br> tags.
 *
 * Walks the tree tracking whether the current context is bold, honouring both
 * <b>/<strong> elements and inline font-weight styles (which is what some
 * browsers produce for execCommand("bold")). This is what makes a partial
 * selection survive a round-trip.
 */
function sanitize(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  let out = "";

  const walk = (parent: Node, bold: boolean): void => {
    parent.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const raw = (child.textContent || "").replace(/\u00a0/g, " ");
        if (!raw) return;
        // Handle any raw newlines in text nodes
        const rawLines = raw.split(/\r\n|\r|\n/);
        rawLines.forEach((rLine, rIdx) => {
          if (rIdx > 0) out += "<br>";
          if (rLine) {
            out += bold ? `<b>${escapeHtml(rLine)}</b>` : escapeHtml(rLine);
          }
        });
        return;
      }
      if (!(child instanceof HTMLElement)) return;

      const tag = child.tagName.toLowerCase();
      if (tag === "br") { out += "<br>"; return; }

      let nextBold = bold;
      if (tag === "b" || tag === "strong") nextBold = true;
      const fw = child.style?.fontWeight;
      if (fw) {
        const numeric = parseInt(fw, 10);
        if (fw === "bold" || fw === "bolder" || (!isNaN(numeric) && numeric >= 600)) nextBold = true;
        else if (fw === "normal" || fw === "lighter" || (!isNaN(numeric) && numeric < 600)) nextBold = false;
      }

      const isBlock = tag === "div" || tag === "p" || tag === "li";
      // A block that follows existing content starts on a new line.
      if (isBlock && out && !out.endsWith("<br>")) out += "<br>";
      walk(child, nextBold);
    });
  };

  walk(container, false);

  // Merge adjacent bold runs and drop empty ones.
  out = out.replace(/<\/b>(\s*)<b>/g, "$1");
  out = out.replace(/<b>\s*<\/b>/g, "");
  // Trim trailing line breaks the browser leaves behind.
  out = out.replace(/(<br>)+$/g, "");
  return out;
}
