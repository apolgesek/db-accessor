const DEFAULT_REDACTION = '<redacted>';

/**
 * Redact fields matching path patterns (supports * and []).
 *
 * Pattern syntax:
 * - Dot-separated segments: "a.b.c"
 * - "*" matches any property name at that level
 * - "[]" matches any array index
 * - "[0]" matches a specific array index
 *
 * Examples:
 * - "contacts[].email"
 * - "orders[0].customer.email"
 * - "payments.*.cardNumber"
 */
export function redactByPathPatterns<T>(
  input: T,
  patterns: readonly string[],
  redactionText: string = DEFAULT_REDACTION,
  options: { mutate?: boolean } = {},
): T {
  const rootTrie = buildTrie(patterns);
  const out: any = options.mutate ? (input as any) : structuredClone(input as any);

  const seen = new WeakSet<object>();
  apply(out, [rootTrie]);
  return out as T;

  function apply(node: any, active: TrieNode[]) {
    if (node == null) return;
    if (typeof node !== 'object') return;

    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const nextActive = nextForArrayIndex(active, i);
        if (nextActive.length === 0) continue;

        if (nextActive.some((n) => n.redact)) {
          node[i] = redactionText;
        } else {
          apply(node[i], nextActive);
        }
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const nextActive = nextForObjectKey(active, key);
      if (nextActive.length === 0) continue;

      if (nextActive.some((n) => n.redact)) {
        (node as any)[key] = redactionText;
      } else {
        apply(value, nextActive);
      }
    }
  }

  function nextForObjectKey(active: TrieNode[], key: string): TrieNode[] {
    const next: TrieNode[] = [];
    for (const n of active) {
      const exact = n.children.get(key);
      if (exact) next.push(exact);

      const star = n.children.get('*');
      if (star) next.push(star);
    }
    return dedupe(next);
  }

  function nextForArrayIndex(active: TrieNode[], index: number): TrieNode[] {
    const next: TrieNode[] = [];
    const idxTok = `[${index}]`;

    for (const n of active) {
      // explicit index: [0], [1], ...
      const exactIdx = n.children.get(idxTok);
      if (exactIdx) next.push(exactIdx);

      // any index: []
      const anyIdx = n.children.get('[]');
      if (anyIdx) next.push(anyIdx);
    }
    return dedupe(next);
  }

  function dedupe(nodes: TrieNode[]): TrieNode[] {
    if (nodes.length <= 1) return nodes;
    const s = new Set<TrieNode>();
    for (const n of nodes) s.add(n);
    return [...s];
  }
}

type TrieNode = {
  children: Map<string, TrieNode>;
  redact: boolean;
};

function buildTrie(patterns: readonly string[]): TrieNode {
  const root: TrieNode = { children: new Map(), redact: false };

  for (const p of patterns) {
    const tokens = tokenizePath(p);
    if (tokens.length === 0) continue;

    let cur = root;
    for (const t of tokens) {
      let child = cur.children.get(t);
      if (!child) {
        child = { children: new Map(), redact: false };
        cur.children.set(t, child);
      }
      cur = child;
    }
    cur.redact = true;
  }

  return root;
}

/**
 * Examples:
 * - "contacts[].email" -> ["contacts","[]","email"]
 * - "orders[0].customer.email" -> ["orders","[0]","customer","email"]
 * - "payments.*.cardNumber" -> ["payments","*","cardNumber"]
 */
function tokenizePath(pattern: string): string[] {
  const rawParts = pattern
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  const tokens: string[] = [];

  for (const part of rawParts) {
    // leading name (could be "*" or "field")
    const m = part.match(/^[^\[]+/);
    if (m?.[0]) tokens.push(m[0]);

    // bracket tokens like [] or [0]
    const brackets = part.match(/\[[^\]]*\]/g);
    if (brackets) tokens.push(...brackets);
  }

  return tokens;
}
