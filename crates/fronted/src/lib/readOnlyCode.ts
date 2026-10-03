// Transcript code behavior; native and shared views render it independently.
export const CHAT_CODE_COLLAPSE_LINES = 12;
export const CHAT_CODE_MAX_HEIGHT = 576;
export const CHAT_CODE_VIEWPORT_FRACTION = 0.6;
export const CHAT_CODE_MAX_HEIGHT_CSS = `min(${CHAT_CODE_VIEWPORT_FRACTION * 100}dvh, ${CHAT_CODE_MAX_HEIGHT / 16}rem)`;
