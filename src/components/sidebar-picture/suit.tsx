import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/** Law: a dark suit, the theme's tie, a brass name plate with the goal under it. */
export function Suit({ name, goal }: PictureProps) {
    const accent = THEMES.law.accent
    return (
        <Frame bg="law" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="#2B2D33" />
                <path d="M86 24L110 104L134 24Q110 32 86 24Z" fill="#FFFFFF" />
                <path d="M104 28h12l-2 8h-8Z" fill={accent} />
                <path d="M106 36h8l3 10-5 50-2 4-2-4-5-50Z" fill={accent} />
                <path d="M86 24L110 104L96 112L68 60L80 52L72 42Z" fill="#3A3D45" />
                <path d="M134 24L110 104L124 112L152 60L140 52L148 42Z" fill="#3A3D45" />
                <path d="M110 112V180" stroke="#1A1B1F" strokeWidth="1.2" />
                <circle cx="110" cy="130" r="3" fill="#1A1B1F" />
                <path d="M142 98h34" stroke="#474A53" strokeWidth="2" />
                <path d="M148 98l6-10 5 6 5-8 6 12Z" fill="#FFFFFF" />
                <rect x="36" y="94" width="58" height="16" rx="2" fill="#C9A24A" />
            </Drawing>
            <Tag x={65} y={98.9} className="text-[7.5px] font-semibold tracking-[1px] text-[#2B2410]">{nameParts(name).capsShort}</Tag>
            <Tag x={65} y={116.4} className="text-[6.8px] tracking-[.8px] text-[#C9A24A]">{goal.toUpperCase()}</Tag>
        </Frame>
    )
}
