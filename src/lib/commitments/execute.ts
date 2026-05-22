// Execute Stage 1 (Item B) — the narrow seam for "Help me execute" (#6.1).
//
// B-1 ships the affordance + slot scaffold INERT: there is no execution-help
// content yet, so this returns false in production and the card renders no Execute
// control (the owner sees nothing until B-2). B-2 replaces this with the real
// reserve_warning money-finding aid once its surface shape is locked (its own
// mini-discovery: checklist / data-driven list / guided pick-one-lever).
//
// Deliberately narrow — reserve_warning only, a boolean availability check, NOT a
// generic multi-type Execute framework. The second commitment type that needs
// execution help is what forces that abstraction; until then this stays a
// "money-finding aid", not a framework.
export function hasExecuteHelp(): boolean {
  return false;
}
