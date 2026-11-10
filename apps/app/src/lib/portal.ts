// Native: overlays render in place (a Modal/sheet library comes with the native map).
import type { ReactNode } from "react";

export function toRoot(node: ReactNode): ReactNode {
  return node;
}
