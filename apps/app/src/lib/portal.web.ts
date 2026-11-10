// Web: render overlays at the root of the page, above the whole layout.
// @ts-expect-error react-dom ships no types in this workspace; only createPortal is used.
import { createPortal } from "react-dom";
import type { ReactNode, ReactPortal } from "react";

export function toRoot(node: ReactNode): ReactNode {
  return typeof document === "undefined" ? node : (createPortal(node, document.body) as ReactPortal);
}
