import type { DeployStepInput } from "@levibostian/decaf-sdk";
import { runDeployScript } from "@levibostian/decaf-sdk/testing";
import { mockBin } from "@levibostian/mock-a-bin";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

// Mock `npx web-ext` so the tests never install or run the real tool.
await mockBin(
  "npx",
  "bash",
  `if [ "$3" = "--help" ]; then
  echo "Options:"
  echo "  -s, --source-dir          Web extension source directory.  [string]"
  echo "  -v, --verbose             Show verbose output  [boolean]"
  echo "  -i, --ignore-files        A list of glob patterns.  [array]"
  echo "      --config-discovery    Discover config files.  [boolean]"
  echo "      --no-input            Disable all features that require standard input  [boolean]"
else
  echo "npx $@"
fi`,
);

interface TestExtension {
  sourceDir: string;
  manifestPath: string;
  cleanup: () => void;
}

const setupExtension = (options?: {
  initialVersion?: string;
  manifestJson?: string;
}): TestExtension => {
  const sourceDir = Deno.makeTempDirSync();
  const manifestPath = join(sourceDir, "manifest.json");
  Deno.writeTextFileSync(
    manifestPath,
    options?.manifestJson ??
      JSON.stringify(
        {
          manifest_version: 2,
          name: "Test Extension",
          version: options?.initialVersion ?? "1.0.0",
          description: "An extension used for tests",
        },
        null,
        2,
      ),
  );

  return {
    sourceDir,
    manifestPath,
    cleanup: () => {
      try {
        Deno.removeSync(sourceDir, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
};

const readManifest = (manifestPath: string): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(manifestPath));

const deployInput = (
  overrides: Partial<DeployStepInput> = {},
): DeployStepInput =>
  ({
    testMode: true,
    nextVersionName: "1.2.3",
    gitCurrentBranch: "main",
    ...overrides,
  }) as unknown as DeployStepInput;

const runScript = (
  extension: TestExtension,
  input: DeployStepInput,
  options?: Parameters<typeof runDeployScript>[2],
  channel = "unlisted",
) =>
  runDeployScript(
    `deno run --allow-all script.ts --channel ${channel}`,
    input,
    {
      ...options,
      extraEnvVariables: {
        DECAF_ROOT_WORKING_DIRECTORY: extension.sourceDir,
        ...options?.extraEnvVariables,
      },
    },
  );

const executedWebExtCommand = (stdout: string[]): string => {
  const command = stdout.find((line) => line.startsWith("npx web-ext "));
  if (command === undefined) {
    throw new Error(
      `No web-ext command found in output:\n${stdout.join("\n")}`,
    );
  }
  return command;
};

Deno.test("test mode updates manifest version and runs web-ext lint", async () => {
  const extension = setupExtension({ initialVersion: "1.0.0" });
  try {
    const { code, stdout } = await runScript(
      extension,
      deployInput({ testMode: true, nextVersionName: "1.2.3" }),
    );

    assertEquals(code, 0);
    assertEquals(readManifest(extension.manifestPath).version, "1.2.3");
    assertEquals(executedWebExtCommand(stdout), "npx web-ext lint --no-input");
    assertStringIncludes(
      stdout.join("\n"),
      "Web extension deployment complete!",
    );
  } finally {
    extension.cleanup();
  }
});

Deno.test("preserves the other manifest.json fields when updating the version", async () => {
  const extension = setupExtension({ initialVersion: "1.0.0" });
  try {
    const { code } = await runScript(
      extension,
      deployInput({ testMode: true, nextVersionName: "3.0.0" }),
    );

    assertEquals(code, 0);
    const manifest = readManifest(extension.manifestPath);
    assertEquals(manifest.name, "Test Extension");
    assertEquals(manifest.manifest_version, 2);
    assertEquals(manifest.description, "An extension used for tests");
  } finally {
    extension.cleanup();
  }
});

Deno.test("non-test mode signs the extension instead of linting", async () => {
  const extension = setupExtension();
  try {
    const { code, stdout } = await runScript(
      extension,
      deployInput({ testMode: false, nextVersionName: "2.0.0" }),
    );

    assertEquals(code, 0);
    assertEquals(
      executedWebExtCommand(stdout),
      "npx web-ext sign --channel unlisted --no-input",
    );
  } finally {
    extension.cleanup();
  }
});

Deno.test("signs with a custom --channel", async () => {
  const extension = setupExtension();
  try {
    const { code, stdout } = await runScript(
      extension,
      deployInput({ testMode: false, nextVersionName: "2.0.0" }),
      undefined,
      "listed",
    );

    assertEquals(code, 0);
    assertEquals(
      executedWebExtCommand(stdout),
      "npx web-ext sign --channel listed --no-input",
    );
  } finally {
    extension.cleanup();
  }
});

Deno.test("forwards extra web-ext sign arguments", async () => {
  const extension = setupExtension();
  try {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts --channel unlisted --api-key test-key --amo-metadata ./metadata.json",
      deployInput({ testMode: false, nextVersionName: "2.0.0" }),
      {
        extraEnvVariables: {
          DECAF_ROOT_WORKING_DIRECTORY: extension.sourceDir,
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(
      executedWebExtCommand(stdout),
      "npx web-ext sign --channel unlisted --api-key test-key --amo-metadata ./metadata.json --no-input",
    );
  } finally {
    extension.cleanup();
  }
});

Deno.test("drops sign-only arguments when linting in test mode", async () => {
  const extension = setupExtension();
  try {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts --channel=listed --api-key test-key --ignore-files a.js b.js --no-config-discovery -v",
      deployInput({ testMode: true }),
      {
        extraEnvVariables: {
          DECAF_ROOT_WORKING_DIRECTORY: extension.sourceDir,
        },
      },
    );

    assertEquals(code, 0);
    assertEquals(
      executedWebExtCommand(stdout),
      "npx web-ext lint --ignore-files a.js b.js --no-config-discovery -v --no-input",
    );
  } finally {
    extension.cleanup();
  }
});

Deno.test("exits with an error when --channel is not provided", async () => {
  const extension = setupExtension();
  try {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts",
      deployInput(),
    );

    assertEquals(code, 1);
    assertStringIncludes(stdout.join("\n"), "--channel argument is required");
  } finally {
    extension.cleanup();
  }
});

Deno.test("exits with an error when manifest.json is missing", async () => {
  const emptyDir = Deno.makeTempDirSync();
  try {
    const { code, stdout } = await runDeployScript(
      "deno run --allow-all script.ts --channel unlisted",
      deployInput(),
      {
        extraEnvVariables: { DECAF_ROOT_WORKING_DIRECTORY: emptyDir },
      },
    );

    assertEquals(code, 1);
    assertStringIncludes(stdout.join("\n"), "No manifest.json file found");
  } finally {
    Deno.removeSync(emptyDir, { recursive: true });
  }
});

Deno.test("adds the version field when manifest.json has none", async () => {
  const extension = setupExtension({
    manifestJson: JSON.stringify({ manifest_version: 2, name: "No version" }),
  });
  try {
    const { code } = await runScript(
      extension,
      deployInput({ testMode: true }),
    );

    assertEquals(code, 0);
    assertEquals(readManifest(extension.manifestPath).version, "1.2.3");
  } finally {
    extension.cleanup();
  }
});

Deno.test("exits with an error when manifest.json is not valid JSON", async () => {
  const extension = setupExtension({ manifestJson: "{ not valid json" });
  try {
    const { code, stdout } = await runScript(extension, deployInput());

    assertEquals(code, 1);
    assertStringIncludes(stdout.join("\n"), "Failed to parse");
  } finally {
    extension.cleanup();
  }
});
