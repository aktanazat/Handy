import type { Env as CompanionEnv } from "../src/types";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env extends CompanionEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
