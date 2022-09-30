import tl  from 'azure-pipelines-task-lib/task';
import { exec } from 'azure-pipelines-task-lib'
import { Octokit } from "@octokit/rest";
import fs from "fs-extra";
import { getPackages, Package } from "@manypkg/get-packages";
import path from "path";
import semver from "semver";
import { PreState } from "@changesets/types";
import {
  getChangelogEntry,
  execWithOutput,
  getChangedPackages,
  sortTheThings,
  getVersionsByDirectory,
  getRepoOwnerObject,
  getVariableErrorMsg,
} from "./utils";
import * as gitUtils from "./gitUtils";
import readChangesetState from "./readChangesetState";
import resolveFrom from "resolve-from";

const repoOwnerObject = getRepoOwnerObject();

// GitHub Issues/PRs messages have a max size limit on the
// message body payload.
// `body is too long (maximum is 65536 characters)`.
// To avoid that, we ensure to cap the message to 60k chars.
const MAX_CHARACTERS_PER_MESSAGE = 60000;

const createRelease = async (
  octokit: Octokit,
  { pkg, tagName }: { pkg: Package; tagName: string }
) => {
  try {
    const changelogFileName = path.join(pkg.dir, "CHANGELOG.md");

    const changelog = await fs.readFile(changelogFileName, "utf8");

    const changelogEntry = getChangelogEntry(changelog, pkg.packageJson.version);
    if (!changelogEntry) {
      // we can find a changelog but not the entry for this version
      // if this is true, something has probably gone wrong
      throw new Error(
        `Could not find changelog entry for ${pkg.packageJson.name}@${pkg.packageJson.version}`
      );
    }

    await octokit.repos.createRelease({
      name: tagName,
      tag_name: tagName,
      body: changelogEntry.content,
      prerelease: pkg.packageJson.version.includes("-"),
      ...repoOwnerObject
    });
  } catch (err: any) {
    // if we can't find a changelog, the user has probably disabled changelogs
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
};

type PublishOptions = {
  script: string;
  githubToken: string;
  createGithubReleases: boolean;
  cwd?: string;
};

type PublishedPackage = { name: string; version: string };

type PublishResult =
  | {
      published: true;
      publishedPackages: PublishedPackage[];
    }
  | {
      published: false;
    };

export async function runPublish({
  script,
  githubToken,
  createGithubReleases,
  cwd = process.cwd(),
}: PublishOptions): Promise<PublishResult> {
  const octokit = new Octokit({
    auth: githubToken
  });
  const [publishCommand, ...publishArgs] = script.split(/\s+/);

  const changesetPublishOutput = await execWithOutput(
    publishCommand,
    publishArgs,
    { cwd }
  );

  await gitUtils.pushTags();

  const { packages, tool } = await getPackages(cwd);
  const releasedPackages: Package[] = [];

  if (tool !== "root") {
    const newTagRegex = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;
    const packagesByName = new Map(packages.map((x) => [x.packageJson.name, x]));

    for (const line of changesetPublishOutput.stdout.split("\n")) {
      const match = line.match(newTagRegex);
      if (match === null) {
        continue;
      }
      const pkgName = match[1];
      const pkg = packagesByName.get(pkgName);
      if (pkg === undefined) {
        throw new Error(
          `Package "${pkgName}" not found.` +
            "This is probably a bug in the task, please open an issue"
        );
      }
      releasedPackages.push(pkg);
    }

    if (createGithubReleases) {
      await Promise.all(
        releasedPackages.map((pkg) =>
          createRelease(octokit, {
            pkg,
            tagName: `${pkg.packageJson.name}@${pkg.packageJson.version}`,
          })
        )
      );
    }
  } else {
    if (packages.length === 0) {
      throw new Error(
        `No package found.` +
          "This is probably a bug in the task, please open an issue"
      );
    }
    const pkg = packages[0];
    const newTagRegex = /New tag:/;

    for (const line of changesetPublishOutput.stdout.split("\n")) {
      const match = line.match(newTagRegex);

      if (match) {
        releasedPackages.push(pkg);
        if (createGithubReleases) {
          await createRelease(octokit, {
            pkg,
            tagName: `v${pkg.packageJson.version}`,
          });
        }
        break;
      }
    }
  }

  if (releasedPackages.length) {
    return {
      published: true,
      publishedPackages: releasedPackages.map((pkg) => ({
        name: pkg.packageJson.name,
        version: pkg.packageJson.version,
      })),
    };
  }

  return { published: false };
}

const requireChangesetsCliPkgJson = (cwd: string) => {
  try {
    return require(resolveFrom(cwd, "@changesets/cli/package.json"));
  } catch (err: any) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Have you forgotten to install \`@changesets/cli\` in "${cwd}"?`
      );
    }
    throw err;
  }
};

type GetMessageOptions = {
  hasPublishScript: boolean;
  branch: string;
  changedPackagesInfo: {
    highestLevel: number;
    private: boolean;
    content: string;
    header: string;
  }[];
  prBodyMaxCharacters: number;
  preState?: PreState;
};

export async function getVersionPrBody({
  hasPublishScript,
  preState,
  changedPackagesInfo,
  prBodyMaxCharacters,
  branch,
}: GetMessageOptions) {
  const messageHeader = `This PR was opened by the [Changesets release](https://github.com/changesets/action) Azure task. When you're ready to do a release, you can merge this and ${
    hasPublishScript
      ? `the packages will be published to npm automatically`
      : `publish to npm yourself or [setup this task to publish automatically](https://github.com/changesets/action#with-publishing)`
  }. If you're not ready to do a release yet, that's fine, whenever you add more changesets to ${branch}, this PR will be updated.
`;
  const messagePrestate = preState
    ? `\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f

\`${branch}\` is currently in **pre mode** so this branch has prereleases rather than normal releases. If you want to exit prereleases, run \`changeset pre exit\` on \`${branch}\`.

\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f\u26a0\ufe0f
`
    : "";
  const messageReleasesHeading = `# Releases`;

  let fullMessage = [
    messageHeader,
    messagePrestate,
    messageReleasesHeading,
    ...changedPackagesInfo.map((info) => `${info.header}\n\n${info.content}`),
  ].join("\n");

  // Check that the message does not exceed the size limit.
  // If not, omit the changelog entries of each package.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> The changelog information of each package has been omitted from this message, as the content exceeds the size limit.\n`,
      ...changedPackagesInfo.map((info) => `${info.header}\n\n`),
    ].join("\n");
  }

  // Check (again) that the message is within the size limit.
  // If not, omit all release content this time.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> All release information have been omitted from this message, as the content exceeds the size limit.`,
    ].join("\n");
  }

  return fullMessage;
}

type VersionOptions = {
  script?: string;
  githubToken: string;
  cwd?: string;
  prTitle?: string;
  commitMessage?: string;
  hasPublishScript?: boolean;
  prBodyMaxCharacters?: number;
};

type RunVersionResult = {
  pullRequestNumber: number;
};

export async function runVersion({
  script,
  githubToken,
  cwd = process.cwd(),
  prTitle = "Version Packages",
  commitMessage = "Version Packages",
  hasPublishScript = false,
  prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
}: VersionOptions): Promise<RunVersionResult> {
  const repo = tl.getVariable("Build.Repository.Name");
  const branch = tl.getVariable("Build.SourceBranchName");
  const commitId = tl.getVariable("Build.SourceVersion");

  if (!repo || !branch || !commitId)
    throw new Error(getVariableErrorMsg("Build.Repository.Name, Build.SourceBranchName, Build.SourceVersion"));

  const versionBranch = `changeset-release/${branch}`;
  const octokit = new Octokit({
    auth: githubToken
  });
  const { preState } = await readChangesetState(cwd);

  await gitUtils.switchToMaybeExistingBranch(versionBranch);
  await gitUtils.reset(commitId);

  const versionsByDirectory = await getVersionsByDirectory(cwd);

  if (script) {
    const [versionCommand, ...versionArgs] = script.split(/\s+/);
    await exec(versionCommand, versionArgs, { cwd });
  } else {
    const changesetsCliPkgJson = requireChangesetsCliPkgJson(cwd);
    const cmd = semver.lt(changesetsCliPkgJson.version, "2.0.0")
      ? "bump"
      : "version";
    await exec("node", [resolveFrom(cwd, "@changesets/cli/bin.js"), cmd], {
      cwd,
    });
  }

  const searchQuery = `repo:${repo}+state:open+head:${versionBranch}+base:${branch}`;
  const searchResultPromise = octokit.search.issuesAndPullRequests({
    q: searchQuery,
  });
  const changedPackages = await getChangedPackages(cwd, versionsByDirectory);
  const changedPackagesInfoPromises = Promise.all(
    changedPackages.map(async (pkg) => {
      const changelogContents = await fs.readFile(
        path.join(pkg.dir, "CHANGELOG.md"),
        "utf8"
      );

      const entry = getChangelogEntry(changelogContents, pkg.packageJson.version);
      return {
        highestLevel: entry.highestLevel,
        private: !!pkg.packageJson.private,
        content: entry.content,
        header: `## ${pkg.packageJson.name}@${pkg.packageJson.version}`,
      };
    })
  );

  const finalPrTitle = `${prTitle}${preState ? ` (${preState.tag})` : ""}`;

  // project with `commit: true` setting could have already committed files
  if (!(await gitUtils.checkIfClean())) {
    const finalCommitMessage = `${commitMessage}${
      preState ? ` (${preState.tag})` : ""
    }`;
    await gitUtils.commitAll(finalCommitMessage);
  }

  await gitUtils.push(versionBranch, { force: true });

  const searchResult = await searchResultPromise;
  console.log(JSON.stringify(searchResult.data, null, 2));

  const changedPackagesInfo = (await changedPackagesInfoPromises)
    .filter((x) => x)
    .sort(sortTheThings);

  const prBody = await getVersionPrBody({
    hasPublishScript,
    preState,
    branch,
    changedPackagesInfo,
    prBodyMaxCharacters,
  });

  if (searchResult.data.items.length === 0) {
    console.log("creating pull request");
    const { data: newPullRequest } = await octokit.pulls.create({
      base: branch,
      head: versionBranch,
      title: finalPrTitle,
      body: prBody,
      ...repoOwnerObject
    });

    return {
      pullRequestNumber: newPullRequest.number,
    };
  } else {
    const [pullRequest] = searchResult.data.items;

    console.log(`updating found pull request #${pullRequest.number}`);
    await octokit.pulls.update({
      pull_number: pullRequest.number,
      title: finalPrTitle,
      body: prBody,
      ...repoOwnerObject
    });

    return {
      pullRequestNumber: pullRequest.number,
    };
  }
}
