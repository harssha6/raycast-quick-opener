const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/ssh.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
const moduleExports = {};
new Function("exports", compiled.outputText)(moduleExports);
const { sshTarget, sshCommand } = moduleExports;

test("host aliases and user@host work; options and shell fragments are refused", () => {
  for (const value of ["my-vps", "deploy@my-vps", "127.0.0.1", "dev_box"]) {
    assert.equal(sshTarget(value), value);
  }
  for (const value of [
    "",
    "-oProxyCommand=touch",
    "-example",
    "user@-host",
    "host;touch marker",
    "$(touch marker)",
    "host\ncommand",
    "a@b@c",
    "user@",
    "@host",
    "host -oProxyCommand=x",
  ]) {
    assert.throws(() => sshTarget(value));
  }
});

test("ports must be integers in the SSH port range", () => {
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity]) {
    assert.throws(() => sshCommand("my-vps", "/tmp", port));
  }
  assert.ok(
    sshCommand("my-vps", "/tmp", 2222).startsWith("ssh -p 2222 -t -- "),
  );
});

test("the local shell passes hostile path text as one remote command without executing it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quick-opener-test-"));
  try {
    fs.writeFileSync(
      path.join(dir, "ssh"),
      '#!/bin/sh\nprintf "%s\\0" "$@"\n',
      { mode: 0o700 },
    );
    const marker = path.join(dir, "executed");
    const directory = `/tmp/folder with 'quotes'\n$(touch ${marker}); echo nope`;
    const output = execFileSync(
      "/bin/sh",
      ["-c", sshCommand("deploy@my-vps", directory, 2222)],
      {
        env: { ...process.env, PATH: dir },
      },
    );
    const args = output.toString().split("\0").slice(0, -1);
    assert.deepEqual(args.slice(0, 5), [
      "-p",
      "2222",
      "-t",
      "--",
      "deploy@my-vps",
    ]);
    assert.equal(args.length, 6);
    assert.ok(args[5].startsWith("cd "));
    assert.ok(args[5].endsWith(" && exec $SHELL -l"));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
