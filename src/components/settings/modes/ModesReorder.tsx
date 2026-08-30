import React, { useState } from "react";
import { Reorder } from "motion/react";
import { MotionScope, springDrag } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* The draggable mode list, alone in its own module.
 *
 * This is the code-split boundary: Motion's `Reorder` is built on the full
 * `motion` component factory, which carries every feature the library has.
 * Nothing in the eager bundle may reach it, so ModesList loads this lazily and
 * renders the same rows as a plain list until the chunk lands. That fallback is
 * not a placeholder — it is the whole list, minus dragging, with the move
 * up/down menu items still doing the same job. */

export interface ModeReorderRow {
  id: string;
  active: boolean;
  selected: boolean;
  /** Everything inside the row: the select button and the overflow menu. */
  body: React.ReactNode;
}

export interface ModesReorderProps {
  rows: readonly ModeReorderRow[];
  /** Accessible name for the list, since its heading is not rendered. */
  label: string;
  /** A mutation is in flight, so a drop could not be committed anyway. */
  disabled: boolean;
  /** The full ordered ID list the backend command takes. */
  onCommit: (orderedIds: string[]) => void;
}

const orderKey = (ids: readonly string[]) => ids.join("\u0000");

export const ModesReorder: React.FC<ModesReorderProps> = ({
  rows,
  label,
  disabled,
  onCommit,
}) => {
  const ids = rows.map((row) => row.id);
  /* The drag reorders locally on every crossing so the rows animate under the
   * pointer, and the backend hears about it once, on drop. Props win whenever
   * they change — which is exactly when the commit came back — so the two
   * orders reconcile without an effect. */
  const [order, setOrder] = useState<string[]>(ids);
  const [propsOrder, setPropsOrder] = useState(orderKey(ids));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  if (orderKey(ids) !== propsOrder) {
    setPropsOrder(orderKey(ids));
    setOrder(ids);
  }

  return (
    <MotionScope strict={false}>
      <Reorder.Group
        as="ul"
        axis="y"
        values={order}
        onReorder={setOrder}
        aria-label={label}
        /* While one row is held, every other row's hover wash is a lie: the
         * pointer is passing over them, not choosing them. The rows read the
         * state off this group. */
        data-dragging={draggingId === null ? undefined : "true"}
        className="group/list divide-y divide-gray-alpha-400"
      >
        {order.map((id) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (!row) return null;
          return (
            <Reorder.Item
              key={id}
              value={id}
              as="li"
              /* The row is the drag handle, so text selection must not
               * compete with the gesture, and a held row lifts on the one
               * shadow every floating surface in the app uses. */
              className={cn(
                "flex touch-none items-center [&_button]:cursor-grab",
                row.selected && "bg-gray-alpha-100",
                draggingId === id &&
                  "relative bg-background-100 shadow-lg [&_button]:cursor-grabbing",
              )}
              data-selected={row.selected || undefined}
              data-active={row.active || undefined}
              data-reorderable="true"
              data-dragging={draggingId === id || undefined}
              dragListener={!disabled}
              /* Release carries the throw. `dragSnapToOrigin` (Reorder's own
               * default) runs the pointer's velocity through an inertia decay
               * and lands it on this spring, so a flick and a nudge arrive
               * differently — and neither rings, because springDrag is damped
               * for exactly this. */
              dragTransition={{
                bounceStiffness: springDrag.stiffness,
                bounceDamping: springDrag.damping,
              }}
              /* The same spring closes the gap under every other row. */
              transition={springDrag}
              onDragStart={() => setDraggingId(id)}
              onDragEnd={() => {
                setDraggingId(null);
                if (orderKey(order) !== propsOrder) onCommit(order);
              }}
            >
              {row.body}
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </MotionScope>
  );
};

export default ModesReorder;
