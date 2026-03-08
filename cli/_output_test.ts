import { expect } from "@std/expect";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { error, info, step, stepInfo, warn } from "./_output.ts";

Deno.test("step writes action prefix to stdout", () => {
  const logStub = stub(console, "log");
  try {
    step("Bundle", "my-agent");
    assertSpyCalls(logStub, 1);
    expect(logStub.calls[0].args[0]).toContain("Bundle");
    expect(logStub.calls[0].args[0]).toContain("my-agent");
  } finally {
    logStub.restore();
  }
});

Deno.test("stepInfo writes action prefix to stdout", () => {
  const logStub = stub(console, "log");
  try {
    stepInfo("Watch", "for changes...");
    assertSpyCalls(logStub, 1);
    expect(logStub.calls[0].args[0]).toContain("Watch");
  } finally {
    logStub.restore();
  }
});

Deno.test("info writes to stdout", () => {
  const logStub = stub(console, "log");
  try {
    info("secondary note");
    assertSpyCalls(logStub, 1);
    expect(logStub.calls[0].args[0]).toContain("secondary note");
  } finally {
    logStub.restore();
  }
});

Deno.test("warn writes to stderr", () => {
  const errStub = stub(console, "error");
  try {
    warn("careful");
    assertSpyCalls(errStub, 1);
    expect(errStub.calls[0].args[0]).toContain("careful");
  } finally {
    errStub.restore();
  }
});

Deno.test("error writes to stderr", () => {
  const errStub = stub(console, "error");
  try {
    error("oops");
    assertSpyCalls(errStub, 1);
    expect(errStub.calls[0].args[0]).toContain("oops");
  } finally {
    errStub.restore();
  }
});
