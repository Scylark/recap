export declare class DomCleaner {
    private readonly keepQuery;
    /** <meta> tags with a secret, by rrweb node id, so later changes to their content are blanked too. */
    private secretMetaIds;
    constructor(keepQuery: boolean);
    /** An rrweb event as it may be stored. Unchanged parts are shared, never copied. */
    clean<E extends {
        type: number;
        [key: string]: unknown;
    }>(e: E): E;
    /** `items` with `fn` applied, or the same array when nothing changed. */
    private list;
    private node;
    private attrs;
    private styleChange;
    /**
     * A same-origin http(s) address without its hash and (unless kept) its query string. Anything
     * else (other sites, data:, blob:, javascript:, relative values rrweb kept on purpose) is unchanged.
     */
    url(value: string, resolveRelative?: boolean): string;
    private srcset;
    private css;
}
