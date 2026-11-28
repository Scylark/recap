// What a page recording may keep of the page's addresses and secrets, applied to every rrweb event
// before it is buffered for upload.
//
// rrweb makes href, src, srcset (and a few more) absolute using the current page's address, so a
// plain <a href="#main"> on /reset-password?token=XYZ is recorded as
// https://site/reset-password?token=XYZ#main. Same-origin addresses therefore lose their hash and,
// unless stripQueryParams is false, their query string, wherever they appear: full snapshots,
// added nodes, attribute changes and CSS url()s. Other sites' addresses are left as they are.
// <meta> tags that carry a per-visitor secret (CSRF tokens and similar) lose their content.

import { sanitizeHref } from '../privacy/sanitize.js';

/** Attributes that hold an address. */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'background', 'poster', 'data', 'action', 'formaction']);
/**
 * Of those, the ones rrweb leaves as written: resolved here. The rest are cleaned only when they
 * are absolute, as rrweb leaves some relative on purpose (<use href="#icon"> in an SVG).
 */
const RESOLVE_ATTRS = new Set(['action', 'formaction', 'poster']);
/** <meta> names whose content is a per-visitor secret: csrf-token, csrf-param, _token, x-csrf-token, xsrf-token, nonces, keys. */
const SECRET_META = /csrf|xsrf|token|nonce|secret|api[-_]?key/i;
/** A CSS url(), quoted or not (the same shape rrweb itself matches). */
const CSS_URL = /url\((?:(')([^']*)'|(")([^"]*)"|([^)]*))\)/gi;
const ABSOLUTE = /^(https?:)?\/\//i;

/**
 * Same-origin image optimisers whose address is nothing but an image path and a size: Next.js
 * `/_next/image?url=/photo.jpg&w=640&q=75` and Astro `/_image?href=…&w=…`. Without the query the
 * picture can't load in the replay, so it is kept when every parameter is one of these and the
 * image is a plain path on the same site.
 */
const IMAGE_OPTIMISERS: Record<string, { image: string; others: string[] }> = {
  '/_next/image': { image: 'url', others: ['w', 'q'] },
  '/_image': { image: 'href', others: ['w', 'h', 'q', 'f'] },
};

function keepsImageQuery(u: URL): boolean {
  const known = IMAGE_OPTIMISERS[u.pathname];
  if (!known || !u.searchParams.has(known.image)) return false;
  for (const [k, v] of u.searchParams) {
    if (k === known.image) {
      if (!v.startsWith('/') || v.startsWith('//') || /[?#]/.test(v)) return false;
    } else if (!known.others.includes(k) || !/^[\w.-]*$/.test(v)) {
      return false;
    }
  }
  return true;
}

type Attrs = Record<string, unknown>;

interface SNode {
  type?: number;
  id?: number;
  tagName?: string;
  attributes?: Attrs;
  childNodes?: SNode[];
  textContent?: string;
  isStyle?: boolean;
  [key: string]: unknown;
}

function isSecretMeta(attrs: Attrs): boolean {
  return ['name', 'property', 'itemprop'].some((k) => typeof attrs[k] === 'string' && SECRET_META.test(attrs[k] as string));
}

export class DomCleaner {
  /** <meta> tags with a secret, by rrweb node id, so later changes to their content are blanked too. */
  private secretMetaIds = new Set<number>();

  constructor(private readonly keepQuery: boolean) {}

  /** An rrweb event as it may be stored. Unchanged parts are shared, never copied. */
  clean<E extends { type: number; [key: string]: unknown }>(e: E): E {
    const data = e['data'] as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return e;
    switch (e.type) {
      case 4: {
        // Meta: the page address. Keep origin and path: the Replayer needs an absolute address.
        if (typeof data['href'] !== 'string') return e;
        return { ...e, data: { ...data, href: sanitizeHref(data['href'], !this.keepQuery) } };
      }
      case 2: {
        // Full snapshot: rrweb numbers the nodes afresh.
        this.secretMetaIds.clear();
        const node = data['node'] as SNode | undefined;
        if (!node || typeof node !== 'object') return e;
        const cleaned = this.node(node);
        return cleaned === node ? e : { ...e, data: { ...data, node: cleaned } };
      }
      case 3: {
        if (data['source'] !== 0) return e; // only DOM mutations carry addresses
        const out: Record<string, unknown> = {};
        const adds = data['adds'];
        if (Array.isArray(adds)) {
          const next = this.list(adds, (a: { node?: SNode }) => {
            if (!a || typeof a !== 'object' || !a.node) return a;
            const node = this.node(a.node);
            return node === a.node ? a : { ...a, node };
          });
          if (next !== adds) out['adds'] = next;
        }
        const attributes = data['attributes'];
        if (Array.isArray(attributes)) {
          const next = this.list(attributes, (m: { id?: number; attributes?: Attrs }) => {
            if (!m || typeof m !== 'object' || !m.attributes || typeof m.attributes !== 'object') return m;
            let attrs = this.attrs(m.attributes);
            if (typeof m.id === 'number' && this.secretMetaIds.has(m.id) && typeof attrs['content'] === 'string') {
              attrs = { ...attrs, content: '' };
            }
            return attrs === m.attributes ? m : { ...m, attributes: attrs };
          });
          if (next !== attributes) out['attributes'] = next;
        }
        return Object.keys(out).length ? { ...e, data: { ...data, ...out } } : e;
      }
      default:
        return e;
    }
  }

  /** `items` with `fn` applied, or the same array when nothing changed. */
  private list<T>(items: T[], fn: (item: T) => T): T[] {
    let out: T[] | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const next = fn(item);
      if (next !== item) (out ??= items.slice())[i] = next;
    }
    return out ?? items;
  }

  private node(n: SNode): SNode {
    let changed: Partial<SNode> | null = null;
    if (n.type === 2 && n.attributes && typeof n.attributes === 'object') {
      let attrs = this.attrs(n.attributes);
      if (n.tagName === 'meta' && isSecretMeta(n.attributes)) {
        if (typeof n.id === 'number') this.secretMetaIds.add(n.id);
        if (typeof attrs['content'] === 'string' && attrs['content']) attrs = { ...attrs, content: '' };
      }
      if (attrs !== n.attributes) changed = { attributes: attrs };
    }
    if (n.type === 3 && n.isStyle && typeof n.textContent === 'string') {
      const text = this.css(n.textContent);
      if (text !== n.textContent) changed = { ...changed, textContent: text };
    }
    if (Array.isArray(n.childNodes)) {
      const kids = this.list(n.childNodes, (c) => (c && typeof c === 'object' ? this.node(c) : c));
      if (kids !== n.childNodes) changed = { ...changed, childNodes: kids };
    }
    return changed ? { ...n, ...changed } : n;
  }

  private attrs(attrs: Attrs): Attrs {
    let out: Attrs | null = null;
    for (const [key, value] of Object.entries(attrs)) {
      const name = key.toLowerCase();
      let next: unknown = value;
      if (typeof value === 'string' && value) {
        if (name === 'srcset') next = this.srcset(value);
        else if (name === 'style' || name === '_csstext') next = this.css(value);
        else if (URL_ATTRS.has(name)) next = this.url(value, RESOLVE_ATTRS.has(name));
      } else if (name === 'style' && value && typeof value === 'object') {
        // An attribute change to the style attribute: { property: value | [value, priority] | false }.
        next = this.styleChange(value as Record<string, unknown>);
      }
      if (next !== value) (out ??= { ...attrs })[key] = next;
    }
    return out ?? attrs;
  }

  private styleChange(style: Record<string, unknown>): Record<string, unknown> {
    let out: Record<string, unknown> | null = null;
    for (const [prop, v] of Object.entries(style)) {
      let next: unknown = v;
      if (typeof v === 'string') next = this.css(v);
      else if (Array.isArray(v) && typeof v[0] === 'string') {
        const css = this.css(v[0]);
        if (css !== v[0]) next = [css, ...v.slice(1)];
      }
      if (next !== v) (out ??= { ...style })[prop] = next;
    }
    return out ?? style;
  }

  /**
   * A same-origin http(s) address without its hash and (unless kept) its query string. Anything
   * else (other sites, data:, blob:, javascript:, relative values rrweb kept on purpose) is unchanged.
   */
  url(value: string, resolveRelative = false): string {
    const v = value.trim();
    if (!v || (!resolveRelative && !ABSOLUTE.test(v))) return value;
    if (typeof location === 'undefined') return value;
    let u: URL;
    try {
      u = new URL(v, location.href);
    } catch {
      return value;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== location.origin) return value;
    if (!u.search && !u.hash) return value;
    const query = this.keepQuery || keepsImageQuery(u) ? u.search : '';
    return u.origin + u.pathname + query;
  }

  private srcset(value: string): string {
    const parts = value.split(/,\s+/);
    let changed = false;
    const out = parts.map((part) => {
      const m = /^(\s*)(\S+)(.*)$/s.exec(part);
      if (!m) return part;
      const url = this.url(m[2]!);
      if (url === m[2]) return part;
      changed = true;
      return `${m[1]}${url}${m[3]}`;
    });
    return changed ? out.join(', ') : value;
  }

  private css(text: string): string {
    if (!/url\(/i.test(text)) return text;
    return text.replace(CSS_URL, (whole, q1?: string, p1?: string, q2?: string, p2?: string, p3?: string) => {
      const raw = p1 ?? p2 ?? p3 ?? '';
      const quote = q1 ?? q2 ?? '';
      const url = this.url(raw.trim());
      return url === raw.trim() ? whole : `url(${quote}${url}${quote})`;
    });
  }
}
