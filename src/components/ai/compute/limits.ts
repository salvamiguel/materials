/* What is reasonable to keep in the browser or put in a link. */

/** Weights kept in localStorage between visits (a few megabytes at most). */
export const MAX_AUTOSAVE = 300_000;
/** Weights in a share link (one byte each, before compression). */
export const MAX_SHARE = 200_000;
export const TOO_BIG_TO_SHARE = 'Este modelo es demasiado grande para un enlace: descarga los pesos en JSON.';
