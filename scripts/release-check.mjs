// Checks that the tree is ready to be released and writes the release notes.
//
//   node scripts/release-check.mjs [--tag v1.2.3] [--notes notes.md]
//
// It fails when the tag (if given) is not "v" plus the package.json version,
// when package-lock.json has a different version, when CHANGELOG.md has no
// dated heading "## <version> (YYYY-MM-DD)", or when an "Unreleased" section
// still has entries. With --notes it writes that version's changelog section
// to the file, for use as the description of the GitHub Release.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const escape = text => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const headingFor = version => new RegExp(String.raw`^${escape(version)}(?:\s|$)`);

/** Splits a changelog into its level-two sections, each { heading, body }. */
export function sections(changelog) {
  const result = [];
  let current;
  for (const line of changelog.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      current = { heading: line.slice(3).trim(), lines: [] };
      result.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return result.map(({ heading, lines }) => ({ heading, body: lines.join('\n').trim() }));
}

/** Returns the body of the changelog section for this version, or undefined. */
export function releaseNotes(changelog, version) {
  return sections(changelog).find(section => headingFor(version).test(section.heading))?.body;
}

/**
 * Checks the release inputs. Returns { problems, notes }: problems lists what
 * blocks the release (empty when it can go ahead), notes is the changelog section.
 */
export function checkRelease({ version, lockVersion, tag, changelog }) {
  const problems = [];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    problems.push(`package.json has no valid version (${JSON.stringify(version)}). Set one with npm version <x.y.z> --no-git-tag-version.`);
    return { problems, notes: undefined };
  }
  if (lockVersion !== version) {
    problems.push(`package-lock.json has version ${lockVersion}, package.json has ${version}. Run npm version ${version} --no-git-tag-version to update both.`);
  }
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(`The tag ${tag} does not match the package.json version ${version}. Tag the release commit as v${version}.`);
  }
  const all = sections(changelog);
  if (all.some(section => /^unreleased$/i.test(section.heading) && section.body !== '')) {
    problems.push('CHANGELOG.md still has entries under "Unreleased". Rename that heading to the release version and date.');
  }
  const section = all.find(section => headingFor(version).test(section.heading));
  if (section) {
    if (!new RegExp(String.raw`^${escape(version)} \(\d{4}-\d{2}-\d{2}\)$`).test(section.heading)) {
      problems.push(`The CHANGELOG.md heading "## ${section.heading}" has no release date. Write it as "## ${version} (YYYY-MM-DD)".`);
    }
    if (section.body === '') problems.push(`The CHANGELOG.md section for ${version} is empty. List the changes of this release.`);
  } else {
    problems.push(`CHANGELOG.md has no heading "## ${version} (YYYY-MM-DD)". Add one with the changes of this release.`);
  }
  return { problems, notes: section?.body };
}

/** Reads package.json, package-lock.json and CHANGELOG.md under root and checks them. */
export async function checkTree(root, tag) {
  const read = name => readFile(new URL(name, root), 'utf8');
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  return { version: pkg.version, ...checkRelease({ version: pkg.version, lockVersion: lock.version, tag, changelog: await read('CHANGELOG.md') }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { tag: { type: 'string' }, notes: { type: 'string' } } });
  const root = pathToFileURL(`${process.cwd()}/`);
  const { version, problems, notes } = await checkTree(root, values.tag);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`release-check: ${problem}`);
    process.exitCode = 1;
  } else {
    if (values.notes) await writeFile(values.notes, `${notes}\n`);
    console.log(`release-check: ${version} is ready to release${values.tag ? ` as ${values.tag}` : ''}.`);
  }
}
