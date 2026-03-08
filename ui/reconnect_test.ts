import { expect } from "@std/expect";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { createReconnect } from "./session.ts";

Deno.test("canRetry true initially, false after max attempts", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(2);
    expect(s.canRetry).toBe(true);
    s.schedule(spy());
    s.schedule(spy());
    expect(s.canRetry).toBe(false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule returns true until exhausted", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(1);
    expect(s.schedule(spy())).toBe(true);
    expect(s.schedule(spy())).toBe(false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule fires callback after delay", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 16_000, 1_000);
    const cb = spy();
    s.schedule(cb);
    assertSpyCalls(cb, 0);
    time.tick(1_000);
    assertSpyCalls(cb, 1);
  } finally {
    time.restore();
  }
});

Deno.test("exponential backoff capped at maxBackoff", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 4_000, 1_000);

    // 1st: 1000 * 2^0 = 1000ms
    const cb1 = spy();
    s.schedule(cb1);
    time.tick(1_000);
    assertSpyCalls(cb1, 1);

    // 2nd: 1000 * 2^1 = 2000ms
    const cb2 = spy();
    s.schedule(cb2);
    time.tick(2_000);
    assertSpyCalls(cb2, 1);

    // 3rd: 1000 * 2^2 = 4000ms (hits cap)
    const cb3 = spy();
    s.schedule(cb3);
    time.tick(3_999);
    assertSpyCalls(cb3, 0);
    time.tick(1);
    assertSpyCalls(cb3, 1);

    // 4th: capped at 4000ms
    const cb4 = spy();
    s.schedule(cb4);
    time.tick(4_000);
    assertSpyCalls(cb4, 1);
  } finally {
    time.restore();
  }
});

Deno.test("cancel clears pending timer", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 16_000, 1_000);
    const cb = spy();
    s.schedule(cb);
    s.cancel();
    time.tick(10_000);
    assertSpyCalls(cb, 0);
  } finally {
    time.restore();
  }
});

Deno.test("reset restores retry capacity", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(1);
    s.schedule(spy());
    expect(s.canRetry).toBe(false);
    s.reset();
    expect(s.canRetry).toBe(true);
  } finally {
    time.restore();
  }
});
