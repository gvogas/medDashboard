// Before each test file: the lazy pages and sheets (src/lib/lazy.ts) are loaded, so
// they draw at once as they do in the app once the browser has fetched them.

import { beforeAll } from "vitest"
import { preloadAll } from "@/lib/lazy"

beforeAll(() => preloadAll())
