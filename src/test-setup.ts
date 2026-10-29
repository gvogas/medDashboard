// Before each test file: the lazy pages and sheets (src/lib/lazy.ts) are loaded, so
// they draw at once as they do in the app once the browser has fetched them.

import { beforeAll } from "vitest"
import { configure } from "@testing-library/react"
import { preloadAll } from "@/lib/lazy"

/* findBy… and waitFor give up after 1 s by default; a full run on a busy machine can need more */
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => preloadAll())
