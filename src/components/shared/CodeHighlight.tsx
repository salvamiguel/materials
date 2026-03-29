import React from 'react';

interface CodeHighlightProps {
  code: string;
  language?: string;
}

export default function CodeHighlight({ code, language = 'bash' }: CodeHighlightProps) {
  return (
    <pre className="code-highlight">
      <code className={`language-${language}`}>{code}</code>
    </pre>
  );
}
