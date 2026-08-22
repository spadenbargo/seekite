#!/usr/bin/env node

import { scaffoldSeekite, type SeekiteTemplate } from "./index.js";

function usage(): string {
  return `create-seekite [directory] [--template react|vanilla]

Scaffold a Vite app with Seekite indexing, worker search, and UI pre-wired.
The default directory is seekite-app and the default template is react.`;
}

function option(name: string, arguments_: string[]): string | undefined {
  const equals = arguments_.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function positional(arguments_: string[]): string | undefined {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--template") {
      index += 1;
      continue;
    }
    if (!argument?.startsWith("-")) return argument;
  }
  return undefined;
}

async function main(arguments_: string[]): Promise<void> {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    console.log(usage());
    return;
  }

  const target = positional(arguments_) ?? "seekite-app";
  const template = (option("--template", arguments_) ?? "react") as SeekiteTemplate;
  const result = await scaffoldSeekite({ target, template });
  console.log(`Created ${result.template} Seekite app in ${result.directory}`);
  console.log("Install dependencies, then run your package manager's dev script.");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
