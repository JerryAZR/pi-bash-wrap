import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	expandHome,
	detectPackageManager,
	getBwrapInstallHint,
	truncateCommandForDisplay,
	isPathOutsideCwd,
	looksLikeContainerCommand,
} from "../src/utils.js";
import { homedir } from "node:os";

describe("expandHome", () => {
	it("expands ~/ prefix", () => {
		assert.equal(expandHome("~/foo"), `${homedir()}/foo`);
	});

	it("expands lone ~", () => {
		assert.equal(expandHome("~"), homedir());
	});

	it("leaves absolute paths alone", () => {
		assert.equal(expandHome("/usr/bin"), "/usr/bin");
	});

	it("leaves relative paths alone", () => {
		assert.equal(expandHome("./foo"), "./foo");
	});
});

describe("detectPackageManager", () => {
	it("returns a string or null without throwing", () => {
		const pm = detectPackageManager();
		assert.ok(pm === null || typeof pm === "string");
	});
});

describe("getBwrapInstallHint", () => {
	it("returns apt hint", () => {
		assert.ok(getBwrapInstallHint("apt").includes("apt install"));
	});

	it("returns dnf hint", () => {
		assert.ok(getBwrapInstallHint("dnf").includes("dnf install"));
	});

	it("returns pacman hint", () => {
		assert.ok(getBwrapInstallHint("pacman").includes("pacman -S"));
	});

	it("returns zypper hint", () => {
		assert.ok(getBwrapInstallHint("zypper").includes("zypper install"));
	});

	it("returns apk hint", () => {
		assert.ok(getBwrapInstallHint("apk").includes("apk add"));
	});

	it("returns generic hint for null", () => {
		const hint = getBwrapInstallHint(null);
		assert.ok(hint.includes("package manager"));
	});
});


describe("truncateCommandForDisplay", () => {
	it("returns short commands unchanged", () => {
		const cmd = "echo hello";
		assert.equal(truncateCommandForDisplay(cmd), cmd);
	});

	it("returns commands with 16 lines unchanged", () => {
		const cmd = Array.from({ length: 16 }, (_, i) => `line ${i}`).join("\n");
		assert.equal(truncateCommandForDisplay(cmd), cmd);
	});

	it("truncates commands with more than 16 lines", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
		const cmd = lines.join("\n");
		const result = truncateCommandForDisplay(cmd);
		const resultLines = result.split("\n");
		assert.equal(resultLines.length, 16); // 10 + "..." + 5
		assert.equal(resultLines[10], "  ...");
		assert.equal(resultLines[11], "line 15");
		assert.equal(resultLines[15], "line 19");
	});
});

describe("isPathOutsideCwd", () => {
	it("returns false for path inside cwd", () => {
		assert.equal(isPathOutsideCwd("/home/user/project/src/index.ts", "/home/user/project"), false);
	});

	it("returns false for cwd itself", () => {
		assert.equal(isPathOutsideCwd("/home/user/project", "/home/user/project"), false);
	});

	it("returns true for path outside cwd", () => {
		assert.equal(isPathOutsideCwd("/home/user/other/file.txt", "/home/user/project"), true);
	});

	it("returns true for sibling path", () => {
		assert.equal(isPathOutsideCwd("/home/user/other", "/home/user/project"), true);
	});

	it("handles relative paths", () => {
		assert.equal(isPathOutsideCwd("../other/file.txt", "/home/user/project"), true);
		assert.equal(isPathOutsideCwd("./src/file.ts", "/home/user/project"), false);
	});

	it("does not falsely match prefix", () => {
		assert.equal(isPathOutsideCwd("/home/user/projects", "/home/user/project"), true);
	});
});

describe("looksLikeContainerCommand", () => {
	it("matches plain container commands", () => {
		assert.equal(looksLikeContainerCommand("docker run hello-world"), true);
		assert.equal(looksLikeContainerCommand("podman ps"), true);
		assert.equal(looksLikeContainerCommand("buildah bud -t foo ."), true);
		assert.equal(looksLikeContainerCommand("nerdctl images"), true);
	});

	it("matches with env vars and wrappers", () => {
		assert.equal(looksLikeContainerCommand("DOCKER_HOST=tcp://... docker ps"), true);
		assert.equal(looksLikeContainerCommand("sudo docker run -it alpine"), true);
		assert.equal(looksLikeContainerCommand("env FOO=bar podman version"), true);
		assert.equal(looksLikeContainerCommand("time nerdctl pull alpine"), true);
	});

	it("matches absolute and relative paths", () => {
		assert.equal(looksLikeContainerCommand("/usr/bin/docker ps"), true);
		assert.equal(looksLikeContainerCommand("./podman run foo"), true);
		assert.equal(looksLikeContainerCommand("/home/user/bin/buildah"), true);
	});

	it("does not match container tools in strings or later positions", () => {
		assert.equal(looksLikeContainerCommand('echo "docker run hello"'), false);
		assert.equal(looksLikeContainerCommand("cat file | grep docker"), false);
		assert.equal(looksLikeContainerCommand("npm run docker-build"), false);
	});

	it("does not match ordinary commands", () => {
		assert.equal(looksLikeContainerCommand("ls -la"), false);
		assert.equal(looksLikeContainerCommand("npm install"), false);
		assert.equal(looksLikeContainerCommand("python script.py"), false);
	});

	it("handles empty or whitespace input", () => {
		assert.equal(looksLikeContainerCommand(""), false);
		assert.equal(looksLikeContainerCommand("   "), false);
	});
});
