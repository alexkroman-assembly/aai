import { defineAgent, multiTool, z } from "@aai/sdk";
import { capitalize, sampleSize, shuffle, words } from "lodash-es";

const WORD_LISTS: Record<string, string[]> = {
  animals: [
    "cat",
    "dog",
    "elephant",
    "giraffe",
    "penguin",
    "dolphin",
    "octopus",
    "flamingo",
    "chameleon",
    "hedgehog",
    "narwhal",
    "axolotl",
  ],
  colors: [
    "red",
    "blue",
    "green",
    "purple",
    "orange",
    "teal",
    "magenta",
    "coral",
    "indigo",
    "vermillion",
    "cerulean",
    "chartreuse",
  ],
  foods: [
    "pizza",
    "sushi",
    "tacos",
    "ramen",
    "croissant",
    "paella",
    "dumpling",
    "tiramisu",
    "falafel",
    "bibimbap",
    "ceviche",
    "bruschetta",
  ],
};

export default defineAgent({
  name: "Word Wizard",
  instructions:
    `You are Word Wizard, a playful word game host. You help people with word \
games, trivia, and creative text challenges. Keep your tone fun and energetic.

Rules:
- Keep responses short and punchy — this is a voice conversation
- Use the tools to generate random words, anagrams, and creative combos
- Celebrate good answers and encourage players to try again
- Suggest new games if the user seems stuck`,
  greeting:
    "Hey, I'm Word Wizard. Want to play a word game? I can give you random words, test your vocabulary, or help you brainstorm creative names.",
  builtinTools: ["run_code"],
  tools: {
    word_game: multiTool({
      description:
        "Word game tools. Use 'random' to get random words from a category, 'mix' to shuffle letters or words in a phrase.",
      actions: {
        random: {
          schema: z.object({
            category: z.enum(["animals", "colors", "foods"]).describe(
              "Category to pick words from",
            ),
            count: z.number().describe(
              "Number of random words to return (1-6)",
            ),
          }),
          execute: (args) => {
            const { category, count } = args as {
              category: string;
              count: number;
            };
            const list = WORD_LISTS[category];
            if (!list) return { error: `Unknown category: ${category}` };
            const n = Math.min(Math.max(1, count), 6);
            return {
              words: sampleSize(list, n).map((w: string) => capitalize(w)),
            };
          },
        },
        mix: {
          schema: z.object({
            phrase: z.string().describe("The phrase to shuffle"),
            mode: z.enum(["letters", "words"]).describe(
              "Shuffle individual letters or whole words",
            ).optional(),
          }),
          execute: (args) => {
            const { phrase, mode } = args as { phrase: string; mode?: string };
            if (mode === "words") {
              return { result: shuffle(words(phrase)).join(" ") };
            }
            return { result: shuffle(phrase.split("")).join("") };
          },
        },
      },
    }),
  },
});
