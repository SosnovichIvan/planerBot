/** Scroll just the owner, never dialog ancestors or the document. */
export function revealControl(control: HTMLElement, container: HTMLElement, padding = 8) {
  const item = control.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  if (item.top < bounds.top + padding) container.scrollTop += item.top - bounds.top - padding;
  else if (item.bottom > bounds.bottom - padding) container.scrollTop += item.bottom - bounds.bottom + padding;
}
