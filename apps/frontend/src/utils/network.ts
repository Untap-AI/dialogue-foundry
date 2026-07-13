// Shared timeout for backend calls made during widget initialization
// (availability check, widget-config fetch). A hung backend must never leave
// the widget stuck invisible, so every such call aborts and fails open after
// this window.
export const NETWORK_TIMEOUT_MS = 5000
