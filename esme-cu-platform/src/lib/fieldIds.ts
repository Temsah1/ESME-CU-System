/**
 * The ids a labelled field's own fragments get, derived from the control id.
 *
 * Both halves of the kit need them: `FormField` renders a hint and an error under these ids, and a
 * screen that wraps a control the kit does not own has to point `aria-describedby` at the same nodes
 * or the association stops halfway. Living in `lib` rather than in the component file also keeps a
 * helper out of a module that otherwise exports only components.
 */
export const fieldIds = (inputId: string) => ({
  inputId,
  hintId: `${inputId}-hint`,
  errorId: `${inputId}-error`,
});
