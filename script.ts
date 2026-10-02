#!/usr/bin/env -S deno run --quiet --allow-all --no-lock

import { getDeployStepInput } from "@levibostian/decaf-sdk";
import $ from "@david/dax";
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";

// Change to the working directory specified by the decaf environment
const decafRootDir = Deno.env.get("DECAF_ROOT_WORKING_DIRECTORY");
if (decafRootDir) {
  Deno.chdir(decafRootDir);
}

// The caller's arguments are forwarded to `web-ext` verbatim so we don't have
// to mirror every option `web-ext sign` supports. Only parse the values this
// script itself needs.
const rawArgs = [...Deno.args];

const args = parseArgs(rawArgs, {
  string: ["channel"],
});

if (!args.channel) {
  console.error(
    "The --channel argument is required. Pass either 'listed' or 'unlisted'. Exiting.",
  );
  Deno.exit(1);
}

const manifestPath = join(Deno.cwd(), "manifest.json");

let manifestFileExists = false;
try {
  manifestFileExists = Deno.statSync(manifestPath).isFile;
} catch {
  // manifest.json does not exist
}

if (!manifestFileExists) {
  console.error(
    `No manifest.json file found at ${manifestPath}. A web extension must have a manifest.json file to be deployed. Exiting.`,
  );
  Deno.exit(1);
}

const input = getDeployStepInput();

console.log("Time to deploy web extension!");
console.log("");

// Firefox manifest versions are 1-4 dot-separated integers. decaf version names
// are often git tags like "v1.2.3", so strip the leading "v" before writing.
const manifestVersion = input.nextVersionName.replace(/^v/, "");

let manifest: Record<string, unknown>;
try {
  manifest = JSON.parse(Deno.readTextFileSync(manifestPath));
} catch (error) {
  console.error(
    `Failed to parse ${manifestPath} as JSON: ${
      error instanceof Error ? error.message : String(error)
    }. Exiting.`,
  );
  Deno.exit(1);
}

console.log(`Updating manifest.json version to ${manifestVersion}...`);
manifest.version = manifestVersion;
Deno.writeTextFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("✓ Version updated in the manifest.json file successfully");

// `web-ext` validates options strictly per command, so a sign-only option (for
// example `--channel`) makes `web-ext lint` fail. Decaf reuses the same deploy
// arguments in test mode, so ask `web-ext` which options it accepts and drop
// the rest. Reading the options at runtime means no updates are needed when a
// new web-ext release adds or removes options.
const readLintOptions = async (): Promise<Set<string>> => {
  const help = await $`npx web-ext lint --help`.text();
  return new Set(
    [...help.matchAll(/^\s+(?:-\w,\s+)?(--[\w-]+)/gm)].map((match) => match[1]),
  );
};

const filterWebExtArgs = (
  allowedOptions: Set<string>,
  allArgs: string[],
): string[] => {
  const keptArgs: string[] = [];
  let dropNextValue = false;
  for (const arg of allArgs) {
    // A value that belongs to a dropped option is dropped with it.
    if (dropNextValue && !arg.startsWith("-")) {
      dropNextValue = false;
      continue;
    }
    dropNextValue = false;

    if (!arg.startsWith("--")) {
      // Short flags have no sign-only variants, so keep them and positionals.
      keptArgs.push(arg);
      continue;
    }

    const optionName = arg.split("=", 1)[0];
    const isAllowed = allowedOptions.has(optionName) ||
      (optionName.startsWith("--no-") &&
        allowedOptions.has(optionName.replace("--no-", "--")));
    if (isAllowed) {
      keptArgs.push(arg);
    } else if (!arg.includes("=")) {
      dropNextValue = true;
    }
  }
  return keptArgs;
};

// Only filtrer args when running 'lint' because lint only allows a subset
// of args that 'sign' does.
const forwardedArgs = input.testMode
  ? filterWebExtArgs(await readLintOptions(), rawArgs)
  : rawArgs;
const webExtArgs = [input.testMode ? "lint" : "sign", ...forwardedArgs];
if (!forwardedArgs.includes("--no-input")) {
  webExtArgs.push("--no-input");
}

if (input.testMode) {
  console.log("Running in test mode. Linting the extension...");
} else {
  console.log(`Signing the extension for the "${args.channel}" channel...`);
}

await $`npx web-ext ${webExtArgs}`.printCommand();

console.log("✓ Web extension deployment complete!");
