import { Check, Copy } from "lucide-react";
import { useState } from "react";

const command = "pnpm add @seekite/core";

export function InstallCommand() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="install-command"
      type="button"
      aria-label={copied ? "Install command copied" : "Copy install command"}
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      <code>{command}</code>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}
