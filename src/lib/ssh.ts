/** Validate a destination before it reaches SSH, SCP, or an editor. */
export function sshTarget(target: string): string {
  const parts = target.split("@");
  const allowed =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
  if (
    parts.length > 2 ||
    parts.some(
      (part) =>
        !part ||
        part.startsWith("-") ||
        Array.from(part).some((character) => !allowed.includes(character)),
    )
  ) {
    throw new Error(
      "Use an SSH host alias or user@host without options or shell commands",
    );
  }
  return target;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sshCommand(
  target: string,
  directory: string,
  port?: number,
): string {
  sshTarget(target);
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    throw new Error("SSH port must be between 1 and 65535");
  }
  const remoteCommand = `cd ${shellQuote(directory)} && exec $SHELL -l`;
  return `ssh ${port ? `-p ${port} ` : ""}-t -- ${shellQuote(target)} ${shellQuote(remoteCommand)}`;
}
