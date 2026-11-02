import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';

export function highlightCode(code: string, language: string): string {
  const normalizedLang = language.toLowerCase().trim();
  let grammar = Prism.languages[normalizedLang];
  if (!grammar) {
    if (normalizedLang === 'ts' || normalizedLang === 'tsx') grammar = Prism.languages.typescript;
    else if (normalizedLang === 'js' || normalizedLang === 'jsx') grammar = Prism.languages.javascript;
    else if (normalizedLang === 'py') grammar = Prism.languages.python;
    else if (normalizedLang === 'sh' || normalizedLang === 'shell') grammar = Prism.languages.bash;
    else if (normalizedLang === 'yml') grammar = Prism.languages.yaml;
    else grammar = Prism.languages.javascript;
  }
  try {
    return Prism.highlight(code, grammar || Prism.languages.javascript, normalizedLang || 'javascript');
  } catch (e) {
    return code;
  }
}
