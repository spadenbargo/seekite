import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages");
const snapshotsFile = path.join(root, "scripts", "package-contents.json");
const isWindows = process.platform === "win32";
const executable = (name) => (isWindows && ["npm", "pnpm"].includes(name) ? `${name}.cmd` : name);
const bin = (name, directory = root) =>
  path.join(directory, "node_modules", ".bin", `${name}${isWindows ? ".cmd" : ""}`);
const requiredMetadata = [
  "description",
  "license",
  "repository",
  "homepage",
  "bugs",
  "keywords",
  "engines",
  "sideEffects",
  "publishConfig",
];
const ternlightPackages = new Set(["@seekite/embeddings-ternlight", "@seekite/engine-native"]);
const budgetBytes = new Map([
  ["@seekite/search-ui", 4 * 1024],
  ["@seekite/react", 8 * 1024],
]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

const nativePlatformsOnly = process.argv.includes("--native-platforms-only");
const verifyPackDirectory = argumentValue("--verify-pack-dir");
const requestedDestination = argumentValue("--pack-destination");
const requireNativeLinks = process.argv.includes("--require-native-links");
if (nativePlatformsOnly && verifyPackDirectory) {
  throw new Error("--native-platforms-only and --verify-pack-dir cannot be combined");
}

function run(command, arguments_, options = {}) {
  const { capture = false, ...spawnOptions } = options;
  return execFileSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    shell: isWindows && /\.(?:cmd|bat)$/i.test(command),
    stdio: capture ? "pipe" : "inherit",
    ...spawnOptions,
  });
}

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function readManifest(directory) {
  return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
}

async function publicPackages() {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(packageRoot, entry.name);
    if (!(await exists(path.join(directory, "package.json")))) continue;
    const manifest = await readManifest(directory);
    if (!manifest.private) packages.push({ directory, manifest, nativePlatform: false });
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

async function nativePlatformPackages() {
  const directory = path.join(packageRoot, "engine-native", "npm");
  const entries = await readdir(directory, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = path.join(directory, entry.name);
    if (!(await exists(path.join(packageDirectory, "package.json")))) continue;
    packages.push({
      directory: packageDirectory,
      manifest: await readManifest(packageDirectory),
      nativePlatform: true,
    });
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function validateExport(value, label, errors) {
  if (typeof value === "string") return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be a string or condition object`);
    return;
  }
  const conditions = Object.keys(value);
  if ("types" in value && conditions[0] !== "types")
    errors.push(`${label} must list the types condition first`);
  for (const [condition, nested] of Object.entries(value)) {
    if (typeof nested === "object") validateExport(nested, `${label}.${condition}`, errors);
  }
}

function validateMetadata({ directory, manifest, nativePlatform }) {
  const errors = [];
  for (const field of requiredMetadata) {
    if (manifest[field] === undefined) errors.push(`missing ${field}`);
  }
  if (manifest.license !== "MIT") errors.push("license must be MIT");
  if (manifest.engines?.node !== ">=20") errors.push('engines.node must be ">=20"');
  if (manifest.publishConfig?.access !== "public" || manifest.publishConfig?.provenance !== true) {
    errors.push("publishConfig must enable public access and provenance");
  }
  if (manifest.repository?.url !== "git+https://github.com/spadenbargo/seekite.git") {
    errors.push("repository.url must identify seekite/seekite");
  }
  const expectedDirectory = path.relative(root, directory).split(path.sep).join("/");
  if (manifest.repository?.directory !== expectedDirectory) {
    errors.push(`repository.directory must be ${JSON.stringify(expectedDirectory)}`);
  }
  if (manifest.bugs?.url !== "https://github.com/spadenbargo/seekite/issues")
    errors.push("bugs.url is incorrect");
  if (
    typeof manifest.homepage !== "string" ||
    !manifest.homepage.startsWith("https://seekite.badenspargo.com/")
  ) {
    errors.push("homepage must point at seekite.badenspargo.com");
  }
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0)
    errors.push("keywords must be non-empty");
  if (
    !Array.isArray(manifest.files) ||
    !manifest.files.includes("README.md") ||
    !manifest.files.includes("LICENSE")
  ) {
    errors.push("files must explicitly include README.md and LICENSE");
  }
  if (nativePlatform) {
    if (manifest.sideEffects !== false) errors.push("native platform sideEffects must be false");
    if (typeof manifest.main !== "string" || !manifest.main.endsWith(".node")) {
      errors.push("native platform main must name its .node addon");
    }
  } else {
    if (!manifest.exports || typeof manifest.exports !== "object")
      errors.push("exports must be complete");
    for (const [entry, value] of Object.entries(manifest.exports ?? {})) {
      validateExport(value, `exports[${JSON.stringify(entry)}]`, errors);
      if (typeof value === "object" && value && !Array.isArray(value) && !("types" in value)) {
        errors.push(`${entry} must provide a types condition`);
      }
    }
  }
  if (errors.length > 0) throw new Error(`${path.relative(root, directory)}: ${errors.join(", ")}`);
}

async function validateLegalFiles(package_) {
  const required = ["README.md", "LICENSE"];
  if (package_.nativePlatform || ternlightPackages.has(package_.manifest.name))
    required.push("TERNLIGHT-LICENSE");
  for (const file of required) {
    if (!(await exists(path.join(package_.directory, file)))) {
      throw new Error(`${path.relative(root, package_.directory)} is missing ${file}`);
    }
    if (!package_.manifest.files.includes(file)) {
      throw new Error(`${package_.manifest.name} files does not include ${file}`);
    }
  }
}

async function packedTarball(package_, destination) {
  const before = new Set(await readdir(destination));
  run(executable("pnpm"), ["--dir", package_.directory, "pack", "--pack-destination", destination]);
  const after = await readdir(destination);
  const created = after.find((file) => file.endsWith(".tgz") && !before.has(file));
  if (!created) throw new Error(`pnpm pack produced no tarball for ${package_.manifest.name}`);
  return path.join(destination, created);
}

function tarballContents(tarball) {
  return run("tar", ["-tzf", tarball], { capture: true })
    .split(/\r?\n/)
    .map((file) => file.replace(/^\.\//, ""))
    .filter((file) => file.startsWith("package/") && file !== "package/" && !file.endsWith("/"))
    .map((file) => file.slice("package/".length))
    .sort((left, right) => left.localeCompare(right));
}

function packedManifest(tarball) {
  return JSON.parse(run("tar", ["-xOzf", tarball, "package/package.json"], { capture: true }));
}

function exportTargets(value, targets = []) {
  if (typeof value === "string") targets.push(value);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, targets);
  }
  return targets;
}

function assertPackedTargets(package_, manifest, contents) {
  const targets = exportTargets(manifest.exports);
  if (typeof manifest.main === "string") targets.push(manifest.main);
  if (typeof manifest.module === "string") targets.push(manifest.module);
  if (typeof manifest.types === "string") targets.push(manifest.types);
  if (typeof manifest.bin === "string") targets.push(manifest.bin);
  else if (manifest.bin) targets.push(...Object.values(manifest.bin));
  for (const target of new Set(targets)) {
    const normalized = target.replace(/^\.\//, "");
    if (!contents.includes(normalized)) {
      throw new Error(`${package_.manifest.name} tarball is missing declared target ${target}`);
    }
  }
  for (const declared of manifest.files ?? []) {
    const normalized = declared.replace(/^\.\//, "").replace(/\/$/, "");
    if (!contents.some((file) => file === normalized || file.startsWith(`${normalized}/`))) {
      throw new Error(
        `${package_.manifest.name} tarball has no content for files entry ${declared}`,
      );
    }
  }
}

function assertSnapshot(name, contents, snapshots) {
  const expected = snapshots[name];
  if (!expected) throw new Error(`${name} has no entry in scripts/package-contents.json`);
  const actualText = JSON.stringify(contents);
  const expectedText = JSON.stringify(
    [...expected].sort((left, right) => left.localeCompare(right)),
  );
  if (actualText !== expectedText) {
    const missing = expected.filter((file) => !contents.includes(file));
    const extra = contents.filter((file) => !expected.includes(file));
    throw new Error(
      `${name} packed contents changed; update the reviewed snapshot if intentional` +
        (missing.length ? `\n  missing: ${missing.join(", ")}` : "") +
        (extra.length ? `\n  extra: ${extra.join(", ")}` : ""),
    );
  }
}

async function verifyTarball(package_, tarball, snapshots) {
  const contents = tarballContents(tarball);
  const manifest = packedManifest(tarball);
  validateMetadata({ ...package_, manifest });
  if (JSON.stringify(manifest).includes("workspace:")) {
    throw new Error(`${manifest.name} packed manifest still contains a workspace: range`);
  }
  const required = ["package.json", "README.md", "LICENSE"];
  if (package_.nativePlatform || ternlightPackages.has(manifest.name))
    required.push("TERNLIGHT-LICENSE");
  for (const file of required) {
    if (!contents.includes(file)) throw new Error(`${manifest.name} tarball is missing ${file}`);
  }
  if (!package_.nativePlatform && !contents.some((file) => file.startsWith("dist/"))) {
    throw new Error(`${manifest.name} tarball has no dist output`);
  }
  if (manifest.name === "@seekite/engine-native") {
    for (const model of ["models/mini-int4.bin", "models/base-int4.bin"]) {
      if (!contents.includes(model))
        throw new Error(`${manifest.name} tarball is missing ${model}`);
    }
    if (requireNativeLinks) {
      const platforms = await nativePlatformPackages();
      const expectedNames = new Set(platforms.map(({ manifest: platform }) => platform.name));
      const linkedNames = Object.keys(manifest.optionalDependencies ?? {}).filter((name) =>
        name.startsWith("@seekite/engine-native-"),
      );
      for (const name of expectedNames) {
        if (manifest.optionalDependencies?.[name] !== manifest.version) {
          throw new Error(
            `${manifest.name} must link ${name} at the root version ${manifest.version}`,
          );
        }
      }
      const unexpected = linkedNames.filter((name) => !expectedNames.has(name));
      if (unexpected.length > 0)
        throw new Error(`${manifest.name} has unknown native links: ${unexpected.join(", ")}`);
    }
  }
  if (package_.nativePlatform) {
    const rootManifest = await readManifest(path.join(packageRoot, "engine-native"));
    if (manifest.version !== rootManifest.version) {
      throw new Error(
        `${manifest.name}@${manifest.version} does not match @seekite/engine-native@${rootManifest.version}`,
      );
    }
  }
  assertPackedTargets(package_, manifest, contents);
  assertSnapshot(manifest.name, contents, snapshots);
  run(bin("publint"), ["run", tarball, "--strict"]);
  if (!package_.nativePlatform) run(bin("attw"), [tarball, "--profile", "esm-only"]);
  return manifest;
}

function runtimeTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  for (const condition of ["node", "import", "default", "require", "browser"]) {
    if (condition in value) return runtimeTarget(value[condition]);
  }
  return Object.values(value).map(runtimeTarget).find(Boolean);
}

function importSpecifiers(packages) {
  const specifiers = [];
  for (const { manifest } of packages) {
    for (const [entry, value] of Object.entries(manifest.exports ?? {})) {
      const target = runtimeTarget(value);
      if (!target || /\.css(?:$|\?)/.test(target)) continue;
      specifiers.push(
        entry === "." ? manifest.name : `${manifest.name}/${entry.replace(/^\.\//, "")}`,
      );
    }
  }
  return specifiers;
}

async function installSmoke(packages, tarballs, directory) {
  if (tarballs.length === 0) return;
  const project = path.join(directory, "install-smoke");
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify({ name: "seekite-install-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    executable("npm"),
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "react@19.2.8",
      "react-dom@19.2.8",
      "vitepress@1.6.4",
      "vite@8.2.2",
      "vue@3.5.41",
      ...tarballs,
    ],
    { cwd: project },
  );

  const imports = importSpecifiers(packages).map(
    (specifier) => `await import(${JSON.stringify(specifier)})`,
  );
  await writeFile(path.join(project, "smoke.mjs"), `${imports.join("\n")}\n`);
  run(process.execPath, ["smoke.mjs"], {
    cwd: project,
    env: { ...process.env, SEEKITE_DISABLE_NATIVE: "1" },
  });

  const browserCandidates = [
    "@seekite/core",
    "@seekite/embeddings-ternlight",
    "@seekite/search-ui",
    "@seekite/react",
  ];
  const browserImports = [];
  for (const specifier of browserCandidates) {
    if (await exists(path.join(project, "node_modules", ...specifier.split("/"), "package.json"))) {
      browserImports.push(`import ${JSON.stringify(specifier)}`);
    }
  }
  if (browserImports.length > 0) {
    await writeFile(
      path.join(project, "index.html"),
      '<div id="app"></div><script type="module" src="/src.js"></script>\n',
    );
    await writeFile(path.join(project, "src.js"), `${browserImports.join("\n")}\n`);
    run(bin("vite", project), ["build"], { cwd: project });
  }
}

async function verifyBundleBudgets(packages) {
  for (const package_ of packages) {
    const limit = budgetBytes.get(package_.manifest.name);
    if (!limit) continue;
    const entry = runtimeTarget(package_.manifest.exports?.["."]);
    if (!entry)
      throw new Error(`${package_.manifest.name} has no runtime root export for its size budget`);
    const normalized = entry.replace(/^\.\//, "");
    const source = package_.tarball
      ? execFileSync("tar", ["-xOzf", package_.tarball, `package/${normalized}`])
      : await readFile(path.resolve(package_.directory, normalized));
    const bytes = gzipSync(source, { level: 9 }).byteLength;
    if (bytes >= limit) {
      throw new Error(
        `${package_.manifest.name} is ${bytes} B gzip; budget requires less than ${limit} B`,
      );
    }
    console.log(`${package_.manifest.name}: ${bytes} B gzip / <${limit} B`);
  }
}

async function packagesForPackedTarballs(tarballs) {
  const sourcePackages = [...(await publicPackages()), ...(await nativePlatformPackages())];
  const byName = new Map(sourcePackages.map((package_) => [package_.manifest.name, package_]));
  return tarballs.map((tarball) => {
    const manifest = packedManifest(tarball);
    const source = byName.get(manifest.name);
    if (!source) throw new Error(`Packed tarball contains unknown package ${manifest.name}`);
    return { ...source, manifest, tarball };
  });
}

async function tarballsIn(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await tarballsIn(file)));
    else if (entry.isFile() && entry.name.endsWith(".tgz")) found.push(file);
  }
  return found.sort((left, right) => left.localeCompare(right));
}

const snapshots = JSON.parse(await readFile(snapshotsFile, "utf8"));

if (verifyPackDirectory) {
  const tarballs = await tarballsIn(verifyPackDirectory);
  if (tarballs.length === 0) throw new Error(`${verifyPackDirectory} contains no packed tarballs`);
  const packages = await packagesForPackedTarballs(tarballs);
  for (const package_ of packages) await verifyTarball(package_, package_.tarball, snapshots);
  await verifyBundleBudgets(packages);
  const temporary = await mkdtemp(path.join(tmpdir(), "seekite-release-smoke-"));
  try {
    await installSmoke(packages, tarballs, temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`Verified ${packages.length} Changesets release tarballs.`);
} else {
  const packages = nativePlatformsOnly ? await nativePlatformPackages() : await publicPackages();
  for (const package_ of packages) {
    validateMetadata(package_);
    await validateLegalFiles(package_);
  }
  if (!nativePlatformsOnly) await verifyBundleBudgets(packages);

  const temporary =
    requestedDestination ?? (await mkdtemp(path.join(tmpdir(), "seekite-packages-")));
  await mkdir(temporary, { recursive: true });
  try {
    const tarballs = [];
    for (const package_ of packages) {
      const tarball = await packedTarball(package_, temporary);
      await verifyTarball(package_, tarball, snapshots);
      tarballs.push(tarball);
    }
    if (!nativePlatformsOnly) await installSmoke(packages, tarballs, temporary);
    console.log(`Verified ${packages.length} packed Seekite packages.`);
  } finally {
    if (!requestedDestination) await rm(temporary, { recursive: true, force: true });
  }
}
