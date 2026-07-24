import { readFile } from "node:fs/promises";

const canonicalDemoUrl = "https://switchboard-research.vercel.app";
const legacyDemoHost = "switchboard.czarflix.me";

const publicDocumentationFiles = [
  "README.md",
  "LIMITATIONS.md",
  "ARCHITECTURE.md",
  "EVALUATION.md",
  "THREAT_MODEL.md",
];

const contents = new Map(
  await Promise.all(
    publicDocumentationFiles.map(async (path) => [
      path,
      await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
    ]),
  ),
);

const failures = [];
const readme = contents.get("README.md");

if (!readme.includes(`[${canonicalDemoUrl}](${canonicalDemoUrl})`)) {
  failures.push("README.md must publish the canonical public demo URL.");
}

for (const [path, content] of contents) {
  if (content.includes(legacyDemoHost)) {
    failures.push(`${path} still references the legacy custom demo host.`);
  }
}

const requiredStatements = [
  ["README.md", /does not place live outbound calls/i],
  ["README.md", /stage runs a simulation/i],
  ["LIMITATIONS.md", /hosted demo disables live telephony/i],
  ["THREAT_MODEL.md", /hosted demo disables live calls/i],
];

for (const [path, claim] of requiredStatements) {
  if (!claim.test(contents.get(path))) {
    failures.push(`${path} is missing a required calling limitation.`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Public demo links and calling limitations are consistent.");
}
