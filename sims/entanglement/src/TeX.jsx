import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Renders a LaTeX string via KaTeX -- used for this sim's bra-ket notation
// (kets, the Bell-state expressions, the custom-state formula) in place of
// hand-drawing the brackets ourselves. KaTeX ships its own embedded math
// fonts, so -- unlike relying on the browser's own fonts for "|" and "⟩",
// whose vertical reach is an inconsistent font-metric detail -- it renders
// identically everywhere without needing anything drawn by hand, and sizes
// itself off the surrounding element's own font-size (1em), so it reads at
// the same apparent size as the text around it rather than needing that
// tuned by hand per call site.
//
// `math` is developer-authored in every call site in this sim (Bell-state
// labels, fixed formula strings) -- never raw user input -- but
// throwOnError: false is left on regardless, so a typo in one of those
// strings renders KaTeX's own inline error text instead of crashing the
// whole app.
export default function TeX({ math, style, className }) {
  const html = useMemo(() => katex.renderToString(math, { throwOnError: false }), [math]);
  return <span className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
