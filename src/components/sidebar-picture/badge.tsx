import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { fitSize, fitStyle, nameParts } from "./names"

/* the barcode's bars: [x, width], from the prototype, squashed to the badge's foot */
const BARS = [[64, 2], [68, 1], [71, 3], [76, 1], [79, 2], [84, 1], [87, 3], [92, 1], [95, 2], [99, 1], [102, 3], [107, 2], [111, 1], [114, 2], [118, 3], [123, 1], [126, 2], [130, 1], [133, 3], [138, 1], [141, 2], [145, 3], [150, 1], [153, 3]]

/** Computer Science: a lanyard ID badge, initials for a photo, the name in two lines, the goal on the band. */
export function Badge({ name, goal, username }: PictureProps) {
    const accent = THEMES.cs.accent, n = nameParts(name)
    return (
        <Frame bg="cs" name={name} goal={goal}>
            <Drawing>
                <rect x="102" y="0" width="16" height="52" fill={accent} />
                <rect x="104" y="48" width="12" height="12" rx="2" fill="#9AA3A2" />
                <rect x="52" y="58" width="116" height="118" rx="8" fill="#FFFFFF" stroke="#CFCBC2" />
                <rect x="96" y="66" width="28" height="5" rx="2.5" fill="#E6E3DC" />
                <rect x="52" y="78" width="116" height="4" fill={accent} />
                <rect x="64" y="92" width="36" height="42" rx="3" fill="#E6E3DC" />
                <rect x="52" y="142" width="116" height="16" fill={accent} />
                <g fill="#1C1C1A">{BARS.map(([x, w]) => <rect key={x} x={x} y="164" width={w} height="8.1" />)}</g>
            </Drawing>
            <Tag x={82} y={107.2} className="text-[12px] font-semibold text-[#55534E]">{n.initials}</Tag>
            <Tag x={110} y={94.2} left style={{ fontSize: fitSize(n.first, 54, 12, 0.6) }} className="font-semibold text-[#1C1C1A]">{n.first}</Tag>
            <Tag x={110} y={108.2} left style={{ fontSize: fitSize(n.last, 54, 12, 0.6) }} className="font-semibold text-[#1C1C1A]">{n.last}</Tag>
            {username && <Tag x={110} y={124} left className="max-w-[54px] overflow-hidden font-mono text-[8.5px] text-ellipsis text-[#6E6B64]">@{username}</Tag>}
            <Tag x={110} y={146.4} style={fitStyle(goal, 110, 8, 0.6, 0.8)} className="font-mono text-white">{goal.toUpperCase()}</Tag>
        </Frame>
    )
}
