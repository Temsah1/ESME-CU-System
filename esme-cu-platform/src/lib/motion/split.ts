/**
 * Word wrapping for the split-headline reveal.
 *
 * React cannot own this markup: a heading written as `<h2>Two <em>bold</em> words</h2>` has to come
 * out of the splitter with the `<em>` still around the words it wrapped, otherwise the design the
 * editor wrote is what disappears, not the animation. So the components render the sentence as they
 * authored it, and this runs once against the DOM afterwards — idempotent, because a re-render that
 * re-split the same node would wrap `<span class="w">` inside `<span class="w">` forever.
 */

const WORD = /\s+/;

let counter = 0;

function wrapWord(word: string, gradient: boolean): HTMLSpanElement {
  const mask = document.createElement('span');
  mask.className = 'w';
  const inner = document.createElement('span');
  inner.style.setProperty('--i', String(counter));
  counter += 1;
  inner.textContent = word;
  if (gradient) inner.classList.add('grad');
  mask.append(inner);
  return mask;
}

function splitTextNode(node: Text, gradient: boolean) {
  const words = node.textContent.split(WORD);
  const fragment = document.createDocumentFragment();
  words.forEach((word, index) => {
    if (word.length > 0) fragment.append(wrapWord(word, gradient));
    // One space between two words, and nothing after the last — the layout the author wrote.
    if (index < words.length - 1) fragment.append(document.createTextNode(' '));
  });
  node.replaceWith(fragment);
}

function walk(node: Node, gradient: boolean) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child as Text).textContent?.trim().length) splitTextNode(child as Text, gradient);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    if (el.classList.contains('w')) continue;
    if (el.tagName === 'BR' || el.dataset.nosplit !== undefined) continue;
    walk(el, gradient);
  }
}

/** Wraps every word inside `root` in `.w > span`, keeping nested elements and `<br>` where they are. */
export function splitWords(root: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (root.dataset.split === '1') return;
  counter = 0;
  walk(root, root.dataset.splitGrad !== undefined);
  root.dataset.split = '1';
}

/**
 * A word that already exists in the DOM, un-wrapped — used when a heading changes text and has to
 * be split again, since a stale wrapper would keep the previous sentence's words on screen.
 */
export function unsplitWords(root: HTMLElement): void {
  delete root.dataset.split;
}
