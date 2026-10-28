/**
 * Computes a fractional position between two adjacent items.
 *
 * - If neither before nor after is provided: defaults to 1000.
 * - If only after is provided (insert at head): half of after (after / 2).
 * - If only before is provided (insert at tail): before + 1000.
 * - If both are provided (insert between two items): midpoint ((before + after) / 2).
 */
export function between(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) / 2;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}
