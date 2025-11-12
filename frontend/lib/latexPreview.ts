const BLOCK_MATH_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "equation",
  "equation*",
  "multline",
  "multline*",
  "split",
  "cases",
  "pmatrix",
  "bmatrix",
  "vmatrix",
  "Vmatrix",
  "matrix"
]);

const ALIGN_LIKE_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "equation",
  "equation*",
  "multline",
  "multline*",
  "split"
]);

function toPlaceholder(index: number, type: "block" | "inline"): string {
  return type === "block" ? `__NOTE_VLM_BLOCK_MATH_${index}__` : `__NOTE_VLM_INLINE_MATH_${index}__`;
}

function normalizeBlockEnvironment(env: string, body: string): string {
  const cleanBody = body.replace(/\\label\{[^}]*\}/g, "").replace(/\\tag\{[^}]*\}/g, "").trim();
  const baseEnv = env.replace(/\*$/, "");

  if (ALIGN_LIKE_ENVIRONMENTS.has(env)) {
    return `\\begin{aligned}\n${cleanBody}\n\\end{aligned}`;
  }

  return `\\begin{${baseEnv}}\n${cleanBody}\n\\end{${baseEnv}}`;
}

function extractBlockMath(content: string, blockMath: string[]): string {
  return content.replace(
    /\\begin{([a-zA-Z*]+)}([\s\S]*?)\\end{\1}/g,
    (match, env: string, body: string) => {
      if (!BLOCK_MATH_ENVIRONMENTS.has(env)) {
        return match;
      }
      const normalized = normalizeBlockEnvironment(env, body);
      const index = blockMath.push(normalized) - 1;
      return toPlaceholder(index, "block");
    }
  );
}

function extractDisplayMath(content: string, blockMath: string[]): string {
  return content
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, body: string) => {
      const index = blockMath.push(body.trim()) - 1;
      return toPlaceholder(index, "block");
    })
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, body: string) => {
      const index = blockMath.push(body.trim()) - 1;
      return toPlaceholder(index, "block");
    });
}

function extractInlineMath(content: string, inlineMath: string[]): string {
  return content
    .replace(/\\\((.+?)\\\)/gs, (_match, body: string) => {
      const index = inlineMath.push(body.trim()) - 1;
      return toPlaceholder(index, "inline");
    })
    .replace(/\$(?!\$)([^$\n]+)\$(?!\$)/g, (_match, body: string) => {
      const index = inlineMath.push(body.trim()) - 1;
      return toPlaceholder(index, "inline");
    });
}

function convertLists(content: string, pattern: RegExp, bulletFactory: (index: number) => string): string {
  return content.replace(pattern, (_match, body: string) => {
    const items = body
      .split(/\\item/g)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) {
      return "";
    }
    const rendered = items
      .map((item, index) => `${bulletFactory(index)} ${item}`)
      .join("\n");
    return `\n${rendered}\n`;
  });
}

function convertHeadings(content: string): string {
  return content
    .replace(/\\chapter\*?\{([^}]*)\}/g, (_match, title: string) => `\n# ${title.trim()}\n`)
    .replace(/\\section\*?\{([^}]*)\}/g, (_match, title: string) => `\n## ${title.trim()}\n`)
    .replace(/\\subsection\*?\{([^}]*)\}/g, (_match, title: string) => `\n### ${title.trim()}\n`)
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, (_match, title: string) => `\n#### ${title.trim()}\n`)
    .replace(/\\paragraph\*?\{([^}]*)\}/g, (_match, title: string) => `\n##### ${title.trim()}\n`);
}

function convertTextFormatting(content: string): string {
  return content
    .replace(/\\textbf\{([^}]*)\}/g, (_match, inner: string) => `**${inner.trim()}**`)
    .replace(/\\textit\{([^}]*)\}/g, (_match, inner: string) => `*${inner.trim()}*`)
    .replace(/\\emph\{([^}]*)\}/g, (_match, inner: string) => `*${inner.trim()}*`)
    .replace(/\\underline\{([^}]*)\}/g, (_match, inner: string) => `__${inner.trim()}__`)
    .replace(/``([^`]*)''/g, (_match, inner: string) => `"${inner}"`)
    .replace(/`([^`]*)'/g, (_match, inner: string) => `'${inner}'`);
}

function convertTextBlocks(content: string): string {
  return content.replace(/\\begin{(center|flushleft|flushright)}([\s\S]*?)\\end{\1}/g, (_match, env: string, body: string) => {
    const text = body.trim();
    if (!text) {
      return "";
    }
    if (env === "center") {
      return `\n\n${text}\n\n`;
    }
    return `\n${text}\n`;
  });
}

function stripPreamble(content: string): string {
  return content
    .replace(/\\documentclass(?:\[[^\]]*])?\{[^}]*\}/g, "")
    .replace(/\\usepackage(?:\[[^\]]*])?\{[^}]*\}/g, "")
    .replace(/\\title\{[^}]*\}/g, "")
    .replace(/\\author\{[^}]*\}/g, "")
    .replace(/\\date\{[^}]*\}/g, "")
    .replace(/\\begin{document}/g, "")
    .replace(/\\end{document}/g, "");
}

function restorePlaceholders(
  content: string,
  blockMath: string[],
  inlineMath: string[]
): string {
  let restored = content;
  restored = restored.replace(/__NOTE_VLM_BLOCK_MATH_(\d+)__/g, (_match, index: string) => {
    const value = blockMath[Number(index)] ?? "";
    return `\n\n$$\n${value}\n$$\n\n`;
  });
  restored = restored.replace(/__NOTE_VLM_INLINE_MATH_(\d+)__/g, (_match, index: string) => {
    const value = inlineMath[Number(index)] ?? "";
    return `$${value}$`;
  });
  return restored;
}

function normalizeWhitespace(content: string): string {
  return content
    .replace(/\t/g, "    ")
    .replace(/\u00a0/g, " ")
    .replace(/\\newline/g, "  \n")
    .replace(/\s+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert raw LaTeX into a Markdown + KaTeX friendly representation for preview rendering.
 */
export function prepareLatexForPreview(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  let working = trimmed.replace(/\r\n/g, "\n");
  const blockMath: string[] = [];
  const inlineMath: string[] = [];

  working = stripPreamble(working);
  working = extractBlockMath(working, blockMath);
  working = extractDisplayMath(working, blockMath);
  working = extractInlineMath(working, inlineMath);

  working = convertLists(working, /\\begin{itemize}([\s\S]*?)\\end{itemize}/g, () => "-");
  working = convertLists(working, /\\begin{enumerate}([\s\S]*?)\\end{enumerate}/g, (index) => `${index + 1}.`);
  working = convertHeadings(working);
  working = convertTextFormatting(working);
  working = convertTextBlocks(working);

  working = working
    .replace(/~+/g, " ")
    .replace(/\\(?:quad|qquad)/g, "  ")
    .replace(/\\;/g, " ")
    .replace(/\\,/g, " ")
    .replace(/\\%/g, "%")
    .replace(/\\#/g, "#")
    .replace(/\\(centering|raggedright|raggedleft)/g, "")
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\ref\{[^}]*\}/g, "")
    .replace(/\\cite\{[^}]*\}/g, "")
    .replace(/\{\\displaystyle\s*([^}]*)}/g, (_match, inner: string) => inner);

  working = normalizeWhitespace(working);
  working = restorePlaceholders(working, blockMath, inlineMath);

  // Fallback: ensure align-like environments are rewritten for KaTeX
  working = working.replace(
    /\\begin{align\*?}([\s\S]*?)\\end{align\*?}/g,
    (_match, body: string) => {
      const cleaned = body
        .replace(/^\s*\n/, "")
        .replace(/\s*$/, "")
        .replace(/\\\\\s*(?=\S)/g, "\\\\\n");
      return `\n\n$$\n\\begin{aligned}\n${cleaned}\n\\end{aligned}\n$$\n\n`;
    }
  );

  return working.trim();
}
