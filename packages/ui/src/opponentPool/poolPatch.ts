/**
 * WHICH RECORDED RUNS A LOBBY MAY DRAW (R-POOL-ANY-VERSION-01): every app version. The pool used to match the app's
 * version prefix (`"0.1.0+"`), which never changed until the desktop app started numbering its releases (v0.2.0,
 * v0.2.1, …). Each new version then saw an empty pool, filled every seat with generated boards and played unrated
 * (owner 2026-11-04: "i click play ranked and then they put me into a practice match"). The card set (`p_set`) is
 * what keeps a drawn run playable; the version is not a filter.
 *
 * Empty = no version filter: the server RPCs read a null prefix as "any" and a `like '%'` matches every row.
 */
export const POOL_PATCH_PREFIX = '';

/** The prefix as the server RPCs take it: null (= any version) for the empty prefix. */
export const poolPatchArg = (prefix: string): string | null => prefix || null;
