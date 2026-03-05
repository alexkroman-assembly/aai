import {
  adjectives,
  animals,
  type Config,
  uniqueNamesGenerator,
} from "unique-names-generator";

const config: Config = {
  dictionaries: [adjectives, animals],
  separator: "-",
  length: 2,
  style: "lowerCase",
};

/** Generate a unique, memorable slug like "calm-fox" or "bright-creek". */
export function generateSlug(): string {
  return uniqueNamesGenerator(config);
}
