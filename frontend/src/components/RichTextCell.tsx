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
        // Nothing highlighted → bold the entire cell contents.
        if (ref.current) {
          const range = document.createRange();
          range.selectNodeContents(ref.current);
          sel?.removeAllRanges();
          sel?.addRange(range);
          boldCurrentSelection();
        }
      } else {
        boldCurrentSelection();
      }
      // The DOM mutation is synchronous, so serialize immediately.
      emitChange();
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
 * Is the current selection already bold? Checks the computed font-weight of the
 * element containing the selection start.
 */
function isSelectionBold(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
  if (!el) return false;
  const fw = window.getComputedStyle(el).fontWeight;
  const num = parseInt(fw, 10);
  return fw === "bold" || fw === "bolder" || (!isNaN(num) && num >= 600);
}

/**
 * Wrap the current (non-collapsed) selection in a new element. Uses
 * range.surroundContents when possible, else extract-and-reinsert for
 * selections that cross element boundaries. Reselects the wrapped content.
 * Returns true if something was wrapped.
 */
function wrapSelection(tag: string, style?: string): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const wrapper = document.createElement(tag);
  if (style) wrapper.setAttribute("style", style);
  try {
    range.surroundContents(wrapper);
  } catch {
    // Selection crosses element boundaries — extract then wrap.
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  // Re-select the wrapped content so repeated toggles keep working.
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(wrapper);
  sel.addRange(nr);
  return true;
}

/**
 * Toggle bold on the current selection using deterministic DOM manipulation
 * (no execCommand). Bold → wrap in <b>; already-bold → wrap in a
 * font-weight:normal span, which sanitize() interprets as "not bold" and which
 * overrides any bold ancestor. sanitize() then normalises the markup on save.
 */
function boldCurrentSelection(): void {
  if (isSelectionBold()) {
    wrapSelection("span", "font-weight:normal");
  } else {
    wrapSelection("b");
  }
}

/**
 * Toggle bold on the current selection (called from the external Bold button).
 * Ensures the editable host is focused with the selection intact, applies the
 * bold, then fires an input event so the owning RichTextCell saves the change.
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

  const savedRange = sel.getRangeAt(0).cloneRange();
  if (document.activeElement !== host) {
    host.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  if (sel.isCollapsed) {
    // Nothing highlighted → bold the whole cell.
    const range = document.createRange();
    range.selectNodeContents(host);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  boldCurrentSelection();
  host.dispatchEvent(new Event("input", { bubbles: true }));
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
