import { assertEquals } from "@std/assert";
import { kvTools } from "./kv_tools.ts";

Deno.test("kvTools", async (t) => {
  await t.step("returns four default tools", () => {
    const tools = kvTools();
    const names = Object.keys(tools).sort();
    assertEquals(names, [
      "forget_memory",
      "list_memories",
      "recall_memory",
      "save_memory",
    ]);
  });

  await t.step("each tool has description and parameters", () => {
    const tools = kvTools();
    for (const [name, def] of Object.entries(tools)) {
      assertEquals(typeof def.description, "string", `${name} description`);
      assertEquals(typeof def.execute, "function", `${name} execute`);
      assertEquals(def.parameters !== undefined, true, `${name} parameters`);
    }
  });

  await t.step("custom names override defaults", () => {
    const tools = kvTools({ names: { save: "store", forget: "erase" } });
    const names = Object.keys(tools).sort();
    assertEquals(names, ["erase", "list_memories", "recall_memory", "store"]);
  });

  await t.step("custom descriptions override defaults", () => {
    const tools = kvTools({
      descriptions: { save: "Custom save description" },
    });
    assertEquals(tools.save_memory.description, "Custom save description");
    assertEquals(
      tools.recall_memory.description,
      "Retrieve a previously saved memory by its key.",
    );
  });
});
