/**
 * Tokenizes redactor-compatible paths.
 *
 * Supported selectors are object wildcards (`*`), array wildcards (`[]`), and
 * non-negative array indexes (`[0]`). Property names may contain whitespace,
 * underscores, and hyphens, but not the path-reserved characters `.[]*`.
 */
export function tokenizePath(path: string): string[] | undefined {
  if (path.length === 0) return undefined;

  const parts = path.split('.');
  if (parts.some((part) => part.trim().length === 0)) return undefined;
  if (parts[0].trim() === '$') return undefined;

  const tokens: string[] = [];

  for (const rawPart of parts) {
    const part = rawPart.trim();

    if (part === '*') {
      tokens.push(part);
      continue;
    }

    let offset = 0;
    const propertyEnd = part.indexOf('[');
    const property = propertyEnd === -1 ? part : part.slice(0, propertyEnd);

    if (property.length > 0) {
      if (/[.*\[\]]/.test(property) || property.trim().length === 0) return undefined;
      tokens.push(property);
      offset = property.length;
    }

    if (offset === part.length) continue;

    while (offset < part.length) {
      const selector = part.slice(offset).match(/^(\[\]|\[(?:0|[1-9]\d*)\])/);
      if (!selector) return undefined;
      tokens.push(selector[0]);
      offset += selector[0].length;
    }
  }

  return tokens.length > 0 ? tokens : undefined;
}

export function getFinalPropertyToken(tokens: readonly string[]): string | undefined {
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token !== '*' && token !== '[]' && !/^\[\d+\]$/.test(token)) return token;
  }

  return undefined;
}
