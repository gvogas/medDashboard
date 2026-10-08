import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { fitSize, fitStyle, nameParts } from "./names"

/* the spiral's rings down the spine */
const RINGS = [28, 44, 60, 76, 92, 108, 124, 140, 156]

/** Notebook (the free plan's theme): a spiral notebook, the name on its label, the goal on a
 *  sticky note, two stickers and a pencil. */
export function Notebook({ name, goal, username }: PictureProps) {
    const { accent } = THEMES.note, n = nameParts(name)
    const first = n.first || "My", last = n.first ? n.last : "notebook"
    const caps = goal.toUpperCase()
    return (
        <Frame bg="note" name={name} goal={goal}>
            <Drawing>
                {/* the cover and its spine */}
                <rect x="56" y="16" width="116" height="156" rx="10" fill="#1C1C1A" fillOpacity=".08" />
                <rect x="52" y="12" width="116" height="156" rx="10" fill={accent} />
                <rect x="52" y="12" width="20" height="156" rx="10" fill="#000000" fillOpacity=".14" />
                <rect x="62" y="12" width="10" height="156" fill="#000000" fillOpacity=".14" />
                {RINGS.map((y) => (
                    <g key={y}>
                        <circle cx="64" cy={y} r="2.2" fill="#2E2A70" />
                        <path d={`M64 ${y}C56 ${y - 5} 47 ${y - 3} 48 ${y + 1}`} fill="none" stroke="#D9D6CF" strokeWidth="2.4" strokeLinecap="round" />
                    </g>
                ))}
                {/* the label */}
                <rect x="82" y="30" width="76" height="50" rx="7" fill="#FFFFFF" />
                <rect x="86" y="34" width="68" height="42" rx="5" fill="none" stroke="#E6E3DC" />
                {/* the sticky note, a little crooked, with tape */}
                <g transform="rotate(-5 120 120)">
                    <rect x="88" y="98" width="64" height="44" rx="2" fill="#FFE58A" />
                    <rect x="88" y="136" width="64" height="6" fill="#000000" fillOpacity=".04" />
                    <rect x="110" y="93" width="22" height="9" fill="#FFFFFF" fillOpacity=".7" />
                </g>
                {/* stickers: a star and a heart, with white edges */}
                <path d="M150 140l3.5 7 7.7 1.1-5.6 5.4 1.3 7.6-6.9-3.6-6.9 3.6 1.3-7.6-5.6-5.4 7.7-1.1z" fill="#FFD15C" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
                <path d="M92 152c0-3 4-5 6.5-2 2.5-3 6.5-1 6.5 2 0 4-6.5 8-6.5 8s-6.5-4-6.5-8z" fill="#F29CB4" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
                {/* the pencil, leaning on the cover */}
                <g transform="rotate(18 192 96)">
                    <rect x="186" y="44" width="11" height="84" rx="1.5" fill="#FFC857" />
                    <rect x="186" y="44" width="3.5" height="84" fill="#000000" fillOpacity=".08" />
                    <rect x="186" y="36" width="11" height="9" rx="2" fill="#F29CB4" />
                    <rect x="186" y="44" width="11" height="4" fill="#B8BDBC" />
                    <path d="M186 128l5.5 14 5.5-14z" fill="#F3D9B1" />
                    <path d="M189.6 137.2l1.9 4.8 1.9-4.8z" fill="#3A3935" />
                </g>
            </Drawing>
            <Tag x={120} y={41} style={{ fontSize: fitSize(first, 62, 13, 0.56) }} className="font-semibold text-[#1C1C1A]">{first}</Tag>
            <Tag x={120} y={56} style={{ fontSize: fitSize(last, 62, 13, 0.56) }} className="font-semibold text-[#1C1C1A]">{last}</Tag>
            {username && <Tag x={120} y={70} className="max-w-[62px] overflow-hidden font-mono text-[8px] text-ellipsis text-[#6E6B64]">@{username}</Tag>}
            <Tag x={120} y={109} style={{ transform: "translateX(-50%) rotate(-5deg)" }} className="text-[7px] font-semibold tracking-[.12em] text-[#6B5310]">HEADED FOR</Tag>
            <Tag x={120} y={121} style={{ ...fitStyle(caps, 56, 10, 0.62, 0.3), transform: "translateX(-50%) rotate(-5deg)" }} className="font-bold text-[#5A4508]">{caps}</Tag>
        </Frame>
    )
}
