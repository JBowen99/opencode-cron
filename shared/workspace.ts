import path from "node:path";

const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function assertWorkspaceName(name: string): string {
  const trimmed = name.trim();
  if (!WORKSPACE_NAME.test(trimmed)) {
    throw new Error(
      "Workspace must be a single folder name using letters, numbers, dots, underscores, or hyphens",
    );
  }
  return trimmed;
}

export function resolveWorkspace(root: string, name: string): string {
  const safe = assertWorkspaceName(name);
  const base = path.resolve(root);
  const dir = path.resolve(base, safe);
  const relative = path.relative(base, dir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error("Workspace must stay inside the sandbox workspaces directory");
  }
  return dir;
}
