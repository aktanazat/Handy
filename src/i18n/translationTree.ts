import { z } from "zod";

/**
 * The shape of one locale's `translation.json` as i18next consumes it: a tree
 * of message groups whose leaves are the strings themselves.
 */
export type TranslationTree = {
  readonly [key: string]: string | TranslationTree;
};

/**
 * A locale's messages addressed the way call sites address them — by the
 * dotted key `t()` is given, with the group nesting already resolved.
 */
export type TranslationBundle = ReadonlyMap<string, string>;

/* The bundle is decoded rather than walked: the schema is the only thing that
 * ever inspects the raw JSON, and it hands back dotted keys, so no consumer
 * has to re-discover which nodes are groups and which are messages. A number,
 * array, or null at a leaf fails here instead of reaching the UI as
 * "[object Object]" or a bare digit. */
const bundleSchema: z.ZodType<
  Map<string, string>,
  z.ZodTypeDef,
  unknown
> = z.lazy(() =>
  z.record(z.union([z.string(), bundleSchema])).transform((group) => {
    const messages = new Map<string, string>();
    for (const [key, value] of Object.entries(group)) {
      if (value instanceof Map) {
        for (const [suffix, message] of value) {
          messages.set(`${key}.${suffix}`, message);
        }
      } else {
        messages.set(key, value);
      }
    }
    return messages;
  }),
);

/**
 * Decode one locale file's contents into its messages.
 *
 * This is the single I/O boundary for translation files: the text goes in, a
 * dotted-key lookup comes out, and nothing downstream inspects raw JSON.
 * Throws a `SyntaxError` for malformed JSON and a `ZodError` naming the
 * offending key path for a bundle that is not a tree of strings.
 */
export const parseTranslationBundle = (contents: string): TranslationBundle =>
  bundleSchema.parse(JSON.parse(contents));
