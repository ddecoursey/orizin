// Central framer-motion surface for the signed-in app. The app uses the
// LazyMotion + `m` pattern with the `domAnimation` feature set (not full
// `motion`, not `domMax`) so the main bundle only carries the animation
// features it actually uses — the marketing HomePage keeps using full
// `motion` in its own lazy chunk. All `m.*` usage must live under the
// <LazyMotion> provider mounted in MainApp.
export { LazyMotion, m, AnimatePresence, useReducedMotion, domAnimation } from "framer-motion";
