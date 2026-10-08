// The theme's picture in the sidebar, with the person's name and goal on it.

import type { Bg } from "@/data/themes"
import type { PictureProps } from "./parts"
import { Coat } from "./coat"
import { Badge } from "./badge"
import { Suit } from "./suit"
import { Jacket } from "./jacket"
import { Jersey } from "./jersey"
import { Vest } from "./vest"
import { Notebook } from "./notebook"

const PICTURES: Record<Bg, (p: PictureProps) => React.JSX.Element> = { note: Notebook, med: Coat, cs: Badge, law: Suit, pilot: Jacket, sports: Jersey, eng: Vest }

export function SidebarPicture({ bg, ...props }: PictureProps & { bg: Bg }) {
    const Picture = PICTURES[bg]
    return <Picture {...props} />
}
