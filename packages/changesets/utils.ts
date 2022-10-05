import * as ap from "azure-pipelines-task-lib";
import * as tl from "azure-pipelines-task-lib/task";
import unified from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import mdastToString from "mdast-util-to-string";
import { getPackages, Package } from "@manypkg/get-packages";
import stream from "stream";

export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
} as const;

export async function getVersionsByDirectory(cwd: string) {
  const { packages } = await getPackages(cwd);
  return new Map(packages.map((x) => [x.dir, x.packageJson.version]));
}

export async function getChangedPackages(
  cwd: string,
  previousVersions: Map<string, string>
) {
  const { packages } = await getPackages(cwd);
  const changedPackages = new Set<Package>();

  for (const pkg of packages) {
    const previousVersion = previousVersions.get(pkg.dir);
    if (previousVersion !== pkg.packageJson.version) {
      changedPackages.add(pkg);
    }
  }

  return [...changedPackages];
}

export function getChangelogEntry(changelog: string, version: string) {
  const ast = unified().use(remarkParse).parse(changelog);

  let highestLevel: number = BumpLevels.dep;

  const nodes = ast.children as Array<any>;
  let headingStartInfo:
    | {
        index: number;
        depth: number;
      }
    | undefined;
  let endIndex: number | undefined;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "heading") {
      const stringified: string = mdastToString.toString(node);
      const match = stringified.toLowerCase().match(/(major|minor|patch)/);
      if (match !== null) {
        const level = BumpLevels[match[0] as "major" | "minor" | "patch"];
        highestLevel = Math.max(level, highestLevel);
      }
      if (headingStartInfo === undefined && stringified === version) {
        headingStartInfo = {
          index: i,
          depth: node.depth,
        };
        continue;
      }
      if (
        endIndex === undefined &&
        headingStartInfo !== undefined &&
        headingStartInfo.depth === node.depth
      ) {
        endIndex = i;
        break;
      }
    }
  }
  if (headingStartInfo) {
    ast.children = (ast.children as any).slice(
      headingStartInfo.index + 1,
      endIndex
    );
  }
  return {
    content: unified().use(remarkStringify).stringify(ast),
    highestLevel: highestLevel,
  };
}

export async function execWithOutput(
  command: string,
  args?: string[],
  options?: { ignoreReturnCode?: boolean; cwd?: string }
) {
  let myOutput = "";
  let myError = "";

  const outStream = new stream.Writable({
    write(chunk, encoding, callback) {
      const chunkString = chunk.toString();
      console.log(chunkString);
      myOutput += chunkString;
      callback();
    },
  });
  const errStream = new stream.Writable({
    write(chunk, encoding, callback) {
      const chunkString = chunk.toString();
      console.log(chunkString);
      myError += chunkString;
      callback();
    },
  });

  const code = await ap.exec(command, args, {
    outStream,
    errStream,
    ...options,
  });

  return {
    code,
    stdout: myOutput,
    stderr: myError,
  };
}

export function sortTheThings(
  a: { private: boolean; highestLevel: number },
  b: { private: boolean; highestLevel: number }
) {
  if (a.private === b.private) {
    return b.highestLevel - a.highestLevel;
  }
  if (a.private) {
    return 1;
  }
  return -1;
}

export const getVariableErrorMsg = (predefVar: string) =>
  `Microsoft's ${predefVar} predefined variable(s) got deprecated or is not found. Submit an issue to this task's repo.`;

interface IRepoOwner {
  repo: string;
  owner: string;
}

export function getRepoOwnerObject(): IRepoOwner {
  const ownerSlashRepo = tl.getVariable("Build.Repository.Name");
  if (!ownerSlashRepo)
    throw new Error(getVariableErrorMsg("Build.Repository.Name"));

  const [repo, owner] = ownerSlashRepo.split("/");

  if (!repo || !owner)
    throw new Error(
      "Microsoft's Build.Repository.Name predefined variable changed. Submit an issue to this task's repo."
    );

  return {
    repo,
    owner,
  };
}
