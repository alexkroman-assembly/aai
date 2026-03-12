import { assertSnapshot } from "@std/testing/snapshot";
import { z } from "zod";
import {
  AgentConfigSchema,
  ClientMessageSchema,
  DeployBodySchema,
  EnvSchema,
  ServerMessageSchema,
  ToolSchemaSchema,
  TransportSchema,
} from "./_schemas.ts";

Deno.test("TransportSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(TransportSchema));
});

Deno.test("AgentConfigSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(AgentConfigSchema));
});

Deno.test("ToolSchemaSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ToolSchemaSchema));
});

Deno.test("DeployBodySchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(DeployBodySchema));
});

Deno.test("EnvSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(EnvSchema));
});

Deno.test("ServerMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ServerMessageSchema));
});

Deno.test("ClientMessageSchema snapshot", async (t) => {
  await assertSnapshot(t, z.toJSONSchema(ClientMessageSchema));
});
