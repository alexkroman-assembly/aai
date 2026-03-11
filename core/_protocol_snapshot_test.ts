import { assertSnapshot } from "@std/testing/snapshot";
import { z } from "zod";
import {
  AudioFrameSpec,
  ClientMessageSchema,
  ClientStateMachine,
  DevRegisteredSchema,
  DevRegisterSchema,
  ServerMessageSchema,
  ServerStateMachine,
} from "./_protocol.ts";

Deno.test("DevRegisterSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(DevRegisterSchema));
});

Deno.test("DevRegisteredSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(DevRegisteredSchema));
});

Deno.test("ServerMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ServerMessageSchema));
});

Deno.test("ClientMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ClientMessageSchema));
});

Deno.test("AudioFrameSpec snapshot", async (t) => {
  await assertSnapshot(t, AudioFrameSpec);
});

Deno.test("ServerStateMachine snapshot", async (t) => {
  await assertSnapshot(t, ServerStateMachine);
});

Deno.test("ClientStateMachine snapshot", async (t) => {
  await assertSnapshot(t, ClientStateMachine);
});
