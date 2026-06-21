import { useSyncExternalStore } from "react";

function subscribe(onStoreChange) {
  const obs = new MutationObserver(onStoreChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

function getSnapshot() {
  return document.documentElement.classList.contains("light");
}

export function useIsLightTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}