// The front end's entry. boot() wires the controllers and opens the account, once; React
// draws the whole page into #root. See docs/superpowers/specs/
// 2026-09-27-react-foundation-design.md for the move, stage by stage.

import { boot } from "./boot"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/components/app"

boot()

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
