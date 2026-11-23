/*
  Typing on a phone:
  - `touch` = a finger screen (no mouse): Enter moves to the next field instead of adding at once (see EntryTable).
  - while a field has the focus: body.typing hides the bottom menu (more room above the keyboard) and the field is
    scrolled to the middle of what stays visible once the keyboard is open.
*/
export const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const isField = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)));

export function installTyping() {
  if (!touch || typeof document === 'undefined') return;
  let off = 0;
  document.addEventListener('focusin', e => {
    if (!isField(e.target)) return;
    clearTimeout(off);
    document.body.classList.add('typing');
    // after the keyboard opened (the page got shorter): the field in the middle of what is left
    setTimeout(() => { if (document.activeElement === e.target) e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
  });
  document.addEventListener('focusout', () => {
    // moving to the next field keeps it; leaving all fields shows the menu again
    off = setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('typing'); }, 150);
  });
}
