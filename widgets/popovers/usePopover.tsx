import { shift, flip, Placement } from '@floating-ui/core';
import { useFloating } from '@floating-ui/react-dom';

export function usePopover(placement?: Placement, fallbackPlacements?: Placement[]) {
  const { x, y, refs, strategy, update } = useFloating({
    placement,
    middleware: [
      flip({ fallbackPlacements }),
      shift({ boundary: document.body, crossAxis: true, padding: 8 }),
    ],
  });
  return {
    style: {
      position: strategy,
      top: 0,
      left: 0,
      transform: `translate(${Math.round(x ?? 0.0)}px,${Math.round(y ?? 0.0)}px)`,
    },
    reference: refs.setReference,
    floating: refs.setFloating,
    update,
  };
}
