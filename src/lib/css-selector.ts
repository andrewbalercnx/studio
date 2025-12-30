/**
 * Generates a reliable CSS selector for a DOM element.
 *
 * Priority order:
 * 1. data-wiz-target attribute (most reliable for wizard targeting)
 * 2. id attribute
 * 3. Path-based selector using tag names, classes, and nth-of-type
 */
export function generateCssSelector(element: Element): string {
  // Priority 1: data-wiz-target attribute
  const wizTarget = element.getAttribute('data-wiz-target');
  if (wizTarget) {
    return `[data-wiz-target="${wizTarget}"]`;
  }

  // Priority 2: id attribute
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Priority 3: Build path selector
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    // Skip adding classes for common wrapper elements
    if (!['div', 'span', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'].includes(selector)) {
      // Add a couple meaningful classes (skip utility/state classes)
      if (current.classList.length > 0) {
        const meaningfulClasses = Array.from(current.classList)
          .filter(c =>
            !c.startsWith('hover:') &&
            !c.startsWith('focus:') &&
            !c.startsWith('active:') &&
            !c.startsWith('disabled:') &&
            !c.startsWith('dark:') &&
            !c.startsWith('sm:') &&
            !c.startsWith('md:') &&
            !c.startsWith('lg:') &&
            !c.startsWith('xl:') &&
            !c.startsWith('2xl:') &&
            !c.match(/^(p|m|w|h|min|max|gap|space|text|bg|border|rounded|flex|grid|col|row|items|justify|self|z|opacity|transition|duration|ease|animate)-/)
          )
          .slice(0, 2);

        if (meaningfulClasses.length > 0) {
          selector += meaningfulClasses.map(c => `.${CSS.escape(c)}`).join('');
        }
      }
    }

    // Add nth-of-type if there are siblings of the same type
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Stop if we have a reasonably unique selector (max 4 levels)
    if (path.length >= 4) break;
  }

  return path.join(' > ');
}

/**
 * Gets the wizard target ID from an element, if it has one.
 */
export function getWizardTargetId(element: Element): string | null {
  return element.getAttribute('data-wiz-target');
}
